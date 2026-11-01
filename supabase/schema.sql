-- Amuseworthy: database setup for Supabase.
--
-- Run this once in the Supabase dashboard (SQL Editor → New query → paste → Run).
-- It is safe to run again: tables and the index are created only if missing, and
-- the rules, policies, functions and triggers are replaced with the versions here.
-- Run it again whenever this file changes.
--
-- What it sets up:
--   invites        the email addresses allowed to use the app (you manage this list)
--   ideas          one row per idea; each person can only see and change their own
--   landing_pages  each idea's production page and its permanent address; its owner
--                  changes it, and anyone can read it through landing_page() while
--                  it is published and the owner is invited
--   landing_drafts pages generated for an idea, up to 200 per account, each with its
--                  own address; anyone can read one through landing_draft() while it
--                  is published and the owner is invited
--   page_addresses every page address ever given, so none is given out again
--   landscape_reviews  reviews of an idea's competition, up to 200 per account;
--                  only their owner can read them
--   hook           rejects sign-ups (including Google) from emails not on the invite list
--
-- After running it, turn the hook on: Authentication → Hooks → "Before User Created"
-- → Postgres function → public.hook_before_user_created.

-- is_invited() reads auth.sessions as the role running this file, which owns
-- the functions (on Supabase, postgres). Stop here, before anything changes,
-- if that role can't: otherwise every signed-in request would fail.
do $$
begin
  if not has_table_privilege('auth.sessions', 'select') then
    raise exception 'The role running this file (%) cannot read auth.sessions; run it as postgres in the SQL Editor.', current_user;
  end if;
end $$;

-- ---------- Invite list ----------

create table if not exists public.invites (
  email text primary key check (email = lower(email)),
  note text,
  invited_at timestamptz not null default now()
);

-- True for an email address made only of ASCII letters, digits and symbols,
-- with no spaces. Lowercasing turns some other letters into ASCII ones (the
-- Kelvin sign into k, for one), so a lookalike address could otherwise match
-- an invite.
create or replace function public.plain_email(address text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select address ~ '^[\x21-\x7e]+@[\x21-\x7e]+$';
$$;
revoke all on function public.plain_email(text) from public, anon, authenticated;

-- An invite must be an email address: lowercase, plain ASCII, with no spaces.
-- Rows added before this rule are checked once; any that break it are named
-- in a warning so you can fix or delete them.
alter table public.invites drop constraint if exists invites_email_format;
alter table public.invites add constraint invites_email_format
  check (email = btrim(email) and email like '_%@_%' and public.plain_email(email)) not valid;
do $$
begin
  alter table public.invites validate constraint invites_email_format;
exception when check_violation then
  raise warning 'These invites are not email addresses; fix or delete them: %',
    (select string_agg(quote_literal(email), ', ') from public.invites where not (email = btrim(email) and email like '_%@_%' and public.plain_email(email)));
end $$;

-- Nobody can read or change the invite list through the app's public API; you
-- edit it in the dashboard (Table Editor → invites), which bypasses these rules.
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

-- True when an account's email is on the invite list and the account signs in
-- with Google only. The app signs in with Google alone (README.md); an account
-- with any other way in (an email and password, a phone) never counts, even
-- if that provider is switched on in the dashboard by mistake. A password is
-- kept on the account, not with its ways in, so an account with one doesn't
-- count either (Google accounts have none: NULL, or '' in older ones). Otherwise
-- someone could register an invited address with a password before its owner
-- signs in, and share the account once Supabase links the owner's Google
-- sign-in to it. Only this file's own functions call it.
create or replace function public.invited_account(account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from auth.users u
      join public.invites i on i.email = lower(u.email) and public.plain_email(u.email)
      where u.id = account
    )
    and exists (select 1 from auth.identities a where a.user_id = account and a.provider = 'google')
    and not exists (select 1 from auth.identities a where a.user_id = account and a.provider <> 'google')
    and not exists (select 1 from auth.users u where u.id = account and coalesce(u.encrypted_password, '') <> '');
$$;

revoke all on function public.invited_account(uuid) from public, anon, authenticated;

-- True when the signed-in person's account is invited (invited_account) and
-- their sign-in is still live. Removing an email from the list cuts off that
-- person's access straight away. It reads the account's email, not the one in
-- the sign-in, so changing it to an address not invited cuts off a sign-in
-- made before too, as it does their public pages. An account without an email
-- never matches.
--
-- Supabase checks only an access token's signature and expiry, so without the
-- session check a sign-in ended by a global sign-out, or by deleting its row
-- from auth.sessions (README.md), would keep working until its token expired,
-- up to an hour. Every policy and the Worker ask this function, so they all
-- stop at once. A token without a session_id, or whose session belongs to
-- someone else, never counts. The public page readers ask invited_account
-- about the page's owner instead, so published pages stay up.
create or replace function public.is_invited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and (s.not_after is null or s.not_after > now())
    )
    and public.invited_account(auth.uid());
$$;

revoke all on function public.is_invited() from public, anon;
grant execute on function public.is_invited() to authenticated;

-- ---------- Ideas ----------

create table if not exists public.ideas (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists ideas_user_id_idx on public.ideas (user_id);

-- One idea's data may be up to 128 KB: far more than the app's text limits allow
-- (an idea with every field full is about 35 KB), so it only stops someone
-- storing more by going around the app.
alter table public.ideas drop constraint if exists ideas_data_size;
alter table public.ideas add constraint ideas_data_size check (octet_length(data::text) <= 131072) not valid;
do $$
begin
  alter table public.ideas validate constraint ideas_data_size;
exception when check_violation then
  raise warning 'Some ideas are over 128 KB. They stay as they are, but can only be saved again once they are smaller.';
end $$;

-- The app holds up to 100 ideas per person. The database refuses a new idea
-- past 200: Replace all keeps the old ideas until the new ones are saved, so an
-- account can briefly hold twice the app's limit.
create or replace function public.limit_ideas_per_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One save per account at a time: saves sent together would otherwise each
  -- count the same ideas and all fit in the last free places.
  perform pg_advisory_xact_lock(hashtextextended('ideas_per_account:' || new.user_id::text, 0));
  if not exists (select 1 from public.ideas where id = new.id)
     and (select count(*) from public.ideas where user_id = new.user_id) >= 200 then
    raise exception 'An account can hold at most 200 ideas.'
      using errcode = 'check_violation', constraint = 'ideas_per_account';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_ideas_per_account() from public, anon, authenticated;
drop trigger if exists ideas_per_account on public.ideas;
create trigger ideas_per_account before insert on public.ideas
  for each row execute function public.limit_ideas_per_account();

-- The app needs only these four. Revoking everything first also removes rights
-- Supabase grants by default, such as TRUNCATE, which ignores row-level security.
alter table public.ideas enable row level security;
revoke all on public.ideas from anon, authenticated;
grant select, insert, update, delete on public.ideas to authenticated;

-- Each person sees and changes only their own ideas, and only while invited.
drop policy if exists "Own ideas: read" on public.ideas;
create policy "Own ideas: read" on public.ideas
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own ideas: add" on public.ideas;
create policy "Own ideas: add" on public.ideas
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own ideas: change" on public.ideas;
create policy "Own ideas: change" on public.ideas
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()))
  with check (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own ideas: delete" on public.ideas;
create policy "Own ideas: delete" on public.ideas
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

-- ---------- Landing pages ----------

-- Each idea's production page, served by the site's Worker at /p/<slug>. The
-- row is made with the idea's first draft, whose address (/p/<slug>/<code>)
-- starts with the same slug, and is kept until the idea is deleted: the
-- address never changes or goes to another idea. `html` is the production
-- copy (null until a draft is first made production); unpublishing only sets
-- `published` to false, so publishing again brings the page back as it was.
create table if not exists public.landing_pages (
  idea_id uuid primary key references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null unique,
  html text,
  published_at timestamptz,
  published boolean not null default false
);

-- Pages published before there was a production switch stay published; new
-- rows start with none.
alter table public.landing_pages add column if not exists published boolean not null default true;
alter table public.landing_pages alter column published set default false;
alter table public.landing_pages alter column html drop not null;
alter table public.landing_pages alter column published_at drop not null;
alter table public.landing_pages alter column published_at drop default;

-- A production copy has the time it was made production, and only a page
-- with one can be published.
alter table public.landing_pages drop constraint if exists landing_pages_production;
alter table public.landing_pages add constraint landing_pages_production
  check ((html is null) = (published_at is null) and (html is not null or not published));

create index if not exists landing_pages_user_id_idx on public.landing_pages (user_id);

-- The address is lowercase letters and digits in groups joined by single
-- hyphens, as the app makes it, so it never needs escaping.
alter table public.landing_pages drop constraint if exists landing_pages_slug_format;
alter table public.landing_pages add constraint landing_pages_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 64);

-- A page may be up to 256 KB, the same limit the app checks before publishing.
alter table public.landing_pages drop constraint if exists landing_pages_html_size;
alter table public.landing_pages add constraint landing_pages_html_size check (octet_length(html) <= 262144);

-- A page keeps the address it was first given: saving it again (from any tab
-- or device, even one that hasn't seen the address yet) replaces the HTML but
-- never the address, so a link already shared keeps working. It also stays on
-- its idea and with its owner, so the address never shows another idea.
create or replace function public.keep_landing_page_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.idea_id <> old.idea_id or new.user_id <> old.user_id then
    raise exception 'A page stays on the idea it was made for.' using errcode = 'insufficient_privilege';
  end if;
  new.slug := old.slug;
  return new;
end;
$$;
revoke all on function public.keep_landing_page_slug() from public, anon, authenticated;
drop trigger if exists landing_pages_keep_slug on public.landing_pages;
create trigger landing_pages_keep_slug before update on public.landing_pages
  for each row execute function public.keep_landing_page_slug();

-- An address, once given, is never given again. Every page's address is
-- kept here, with the idea it was given to, and stays when the page goes
-- (with its idea, or its owner's account), so links already shared then show
-- nothing rather than someone else's page. A new page with an address given
-- to another idea is refused as taken (23505, so the app picks another).
-- Only the trigger below uses the list; nobody can read or change it through
-- the API.
create table if not exists public.page_addresses (
  slug text primary key,
  idea_id uuid not null,
  user_id uuid not null,
  given_at timestamptz not null default now()
);
create index if not exists page_addresses_user_id_idx on public.page_addresses (user_id);
alter table public.page_addresses enable row level security;
revoke all on public.page_addresses from anon, authenticated;
-- Addresses of pages made before this list.
insert into public.page_addresses (slug, idea_id, user_id)
  select slug, idea_id, user_id from public.landing_pages
  on conflict (slug) do nothing;

-- The address is claimed in the list before the page is written: two pages
-- given the same address at once wait on the list's key, and the second then
-- finds it taken. A page saved again on its own idea, by its owner, finds its
-- own claim.
-- Deleting a page doesn't touch the list, so deletes and saves never wait on
-- each other here.
-- Only a save that can make a new page claims an address: one its owner, while
-- invited, makes on an idea with no page yet. A save the rules would refuse
-- claims nothing (and so can't tell whether an address was ever given), and
-- saving an idea's page again keeps its address (keep_landing_page_slug), so
-- the address it sends is never claimed. An account can claim at most 1,000
-- addresses in all, so it can't fill the list by making and deleting ideas.
create or replace function public.claim_page_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.user_id is distinct from auth.uid() or not public.is_invited() or not public.owns_idea(new.idea_id) then
      return new;
    end if;
    if exists (select 1 from public.landing_pages where idea_id = new.idea_id) then
      return new;
    end if;
    if not exists (select 1 from public.page_addresses where slug = new.slug and idea_id = new.idea_id and user_id = new.user_id)
      and (select count(*) from public.page_addresses where user_id = new.user_id) >= 1000 then
      raise exception 'An account can give out at most 1,000 page addresses.'
        using errcode = 'check_violation', constraint = 'page_addresses_per_account';
    end if;
  end if;
  insert into public.page_addresses (slug, idea_id, user_id)
    values (new.slug, new.idea_id, new.user_id)
    on conflict (slug) do nothing;
  -- Its own idea and owner: an idea made again with a deleted idea's id, in
  -- another account, doesn't get that idea's address.
  if not exists (select 1 from public.page_addresses where slug = new.slug and idea_id = new.idea_id and user_id = new.user_id) then
    raise exception 'This page address is taken.'
      using errcode = 'unique_violation', constraint = 'page_addresses_pkey';
  end if;
  return new;
end;
$$;
revoke all on function public.claim_page_address() from public, anon, authenticated;
drop trigger if exists landing_pages_claim_address on public.landing_pages;
create trigger landing_pages_claim_address before insert on public.landing_pages
  for each row execute function public.claim_page_address();

-- At most 100 production pages per account (pages with HTML), so one account
-- can't fill the database. A page already made can always be replaced. Saves
-- for the same account are checked one after another, so two at once can't
-- both take the last place: each statement that adds or changes pages waits
-- for the account's lock before it touches any row. Taken there, not in the
-- row trigger below, because by then the save holds the page's row, and two
-- saves taking the row and the lock in opposite orders would deadlock. A
-- change the database makes itself (a deleted draft unlinked from its page)
-- doesn't wait: it never adds HTML, so the limit doesn't apply to it.
create or replace function public.lock_pages_per_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended('landing_pages_per_account:' || auth.uid()::text, 0));
  end if;
  return null;
end;
$$;
revoke all on function public.lock_pages_per_account() from public, anon, authenticated;
drop trigger if exists landing_pages_lock_account on public.landing_pages;
create trigger landing_pages_lock_account before insert or update on public.landing_pages
  for each statement execute function public.lock_pages_per_account();

create or replace function public.limit_pages_per_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.html is null then return new; end if;
  if tg_op = 'UPDATE' and old.html is not null then return new; end if;
  if tg_op = 'INSERT' and exists (select 1 from public.landing_pages where idea_id = new.idea_id and html is not null) then return new; end if;
  if (select count(*) from public.landing_pages where user_id = new.user_id and html is not null) >= 100 then
    raise exception 'An account can have at most 100 production pages. Unpublish and delete ideas you no longer need.'
      using errcode = 'check_violation', constraint = 'landing_pages_per_account';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_pages_per_account() from public, anon, authenticated;
drop trigger if exists landing_pages_per_account on public.landing_pages;
create trigger landing_pages_per_account before insert or update on public.landing_pages
  for each row execute function public.limit_pages_per_account();

-- Never deleted, except with the idea, so the address is never lost.
alter table public.landing_pages enable row level security;
revoke all on public.landing_pages from anon, authenticated;
grant select, insert, update on public.landing_pages to authenticated;

-- True when the idea is the signed-in person's own: a page can only be put on
-- your own idea.
create or replace function public.owns_idea(idea uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ideas where id = idea and user_id = auth.uid());
$$;

revoke all on function public.owns_idea(uuid) from public, anon;
grant execute on function public.owns_idea(uuid) to authenticated;

-- Each person sees and changes only their own pages, and only while invited.
drop policy if exists "Own landing pages: read" on public.landing_pages;
create policy "Own landing pages: read" on public.landing_pages
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

-- Adding and changing pages: see below the drafts, which those rules check.

drop policy if exists "Own landing pages: delete" on public.landing_pages;

-- ---------- Landing page drafts ----------

-- Every page the app generates is kept as a draft, so several (from different
-- models, say) can be compared. Each has its own public address,
-- /p/<the idea's slug>/<code>, while `published`; making one production copies
-- its HTML to landing_pages. Deleting the idea deletes its drafts.

-- Ten random lowercase letters and digits: a draft's part of its address,
-- hard to guess (36^10 codes). Drafts made before keep their six.
create or replace function public.new_draft_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', get_byte(r.b, i) % 36 + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 9) i;
$$;
revoke all on function public.new_draft_code() from public, anon;
grant execute on function public.new_draft_code() to authenticated;

create table if not exists public.landing_drafts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  html text not null,
  created_at timestamptz not null default now(),
  code text not null default public.new_draft_code(),
  published boolean not null default true
);

-- Drafts made before they had addresses get a code each, and stay private
-- (they were made as private drafts); new drafts start published.
alter table public.landing_drafts add column if not exists code text not null default public.new_draft_code();
alter table public.landing_drafts add column if not exists published boolean not null default false;
alter table public.landing_drafts alter column published set default true;

alter table public.landing_drafts drop constraint if exists landing_drafts_code_format;
alter table public.landing_drafts add constraint landing_drafts_code_format check (code ~ '^[a-z0-9]{6}([a-z0-9]{4})?$');
create unique index if not exists landing_drafts_idea_code_idx on public.landing_drafts (idea_id, code);
drop index if exists public.landing_drafts_idea_id_idx;
create index if not exists landing_drafts_user_id_idx on public.landing_drafts (user_id);

alter table public.landing_drafts drop constraint if exists landing_drafts_html_size;
alter table public.landing_drafts add constraint landing_drafts_html_size check (octet_length(html) <= 262144);
alter table public.landing_drafts drop constraint if exists landing_drafts_model_length;
alter table public.landing_drafts add constraint landing_drafts_model_length check (length(model) between 1 and 100);

-- A draft's code is always the database's own random one (new_draft_code):
-- one sent with the draft, such as a short guessable code, is replaced. The
-- app never sends one. Only what the dashboard adds (as another role) keeps
-- the code it is given.
create or replace function public.random_draft_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.code := public.new_draft_code();
  end if;
  return new;
end;
$$;
revoke all on function public.random_draft_code() from public, anon, authenticated;
drop trigger if exists landing_drafts_random_code on public.landing_drafts;
create trigger landing_drafts_random_code before insert on public.landing_drafts
  for each row execute function public.random_draft_code();

-- At most 200 drafts per account, as in the app, on any of its ideas: delete
-- some to make more. So one account can't fill the database (200 pages of
-- 256 KB would be 50 MB). Saves for the same account are checked one after
-- another, so two at once can't both take the last place. Drafts were once
-- also limited per idea (5); that trigger and function go when this runs again.
drop trigger if exists landing_drafts_per_idea on public.landing_drafts;
drop function if exists public.limit_drafts_per_idea();
create or replace function public.limit_drafts_per_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('landing_drafts_per_account:' || new.user_id::text, 0));
  if (select count(*) from public.landing_drafts where user_id = new.user_id) >= 200 then
    raise exception 'An account can have at most 200 landing page drafts. Delete some to make more.'
      using errcode = 'check_violation', constraint = 'landing_drafts_per_account';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_drafts_per_account() from public, anon, authenticated;
drop trigger if exists landing_drafts_per_account on public.landing_drafts;
create trigger landing_drafts_per_account before insert on public.landing_drafts
  for each row execute function public.limit_drafts_per_account();

-- Drafts are added and deleted; the only change is publishing or
-- unpublishing one's address.
alter table public.landing_drafts enable row level security;
revoke all on public.landing_drafts from anon, authenticated;
grant select, insert, delete on public.landing_drafts to authenticated;
grant update (published) on public.landing_drafts to authenticated;

drop policy if exists "Own landing drafts: read" on public.landing_drafts;
create policy "Own landing drafts: read" on public.landing_drafts
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own landing drafts: add" on public.landing_drafts;
create policy "Own landing drafts: add" on public.landing_drafts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_invited()) and public.owns_idea(idea_id));

drop policy if exists "Own landing drafts: change" on public.landing_drafts;
create policy "Own landing drafts: change" on public.landing_drafts
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()))
  with check (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own landing drafts: delete" on public.landing_drafts;
create policy "Own landing drafts: delete" on public.landing_drafts
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

-- Which draft the production page was copied from, so the app can mark it.
-- The page stays up if that draft is deleted.
alter table public.landing_pages add column if not exists draft_id uuid references public.landing_drafts (id) on delete set null;
create index if not exists landing_pages_draft_id_idx on public.landing_pages (draft_id);

-- Each person publishes only on their own ideas, while invited, and only from
-- one of their own drafts of that idea (the draft subquery sees only their own).
drop policy if exists "Own landing pages: add" on public.landing_pages;
create policy "Own landing pages: add" on public.landing_pages
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select public.is_invited()) and public.owns_idea(idea_id)
    and (draft_id is null or exists (select 1 from public.landing_drafts d where d.id = draft_id and d.idea_id = landing_pages.idea_id))
  );

drop policy if exists "Own landing pages: change" on public.landing_pages;
create policy "Own landing pages: change" on public.landing_pages
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()))
  with check (
    user_id = (select auth.uid()) and (select public.is_invited()) and public.owns_idea(idea_id)
    and (draft_id is null or exists (select 1 from public.landing_drafts d where d.id = draft_id and d.idea_id = landing_pages.idea_id))
  );

-- The public side, for the Worker: the production page's HTML by its
-- address, and a draft's by its idea's address and its code. Only while
-- published and while the owner is still invited, so removing an invite takes
-- their pages down too. Nothing else about the page or its owner is given out.
create or replace function public.landing_page(page_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.html
  from public.landing_pages p
  where p.slug = page_slug and p.published and public.invited_account(p.user_id);
$$;

revoke all on function public.landing_page(text) from public;
grant execute on function public.landing_page(text) to anon, authenticated;

create or replace function public.landing_draft(page_slug text, draft_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.html
  from public.landing_drafts d
  join public.landing_pages p on p.idea_id = d.idea_id
  where p.slug = page_slug and d.code = draft_code and d.published and public.invited_account(d.user_id);
$$;

revoke all on function public.landing_draft(text, text) from public;
grant execute on function public.landing_draft(text, text) to anon, authenticated;

-- ---------- Competition reviews ----------

-- Each review of an idea's competition (src/landscape.js) is kept, so it can
-- be read again later and on other devices. Reviews are added and deleted,
-- never changed. Deleting the idea deletes its reviews.
create table if not exists public.landscape_reviews (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists landscape_reviews_idea_id_idx on public.landscape_reviews (idea_id);
create index if not exists landscape_reviews_user_id_idx on public.landscape_reviews (user_id);

alter table public.landscape_reviews drop constraint if exists landscape_reviews_report_size;
alter table public.landscape_reviews add constraint landscape_reviews_report_size check (octet_length(report::text) <= 262144);
alter table public.landscape_reviews drop constraint if exists landscape_reviews_report_object;
alter table public.landscape_reviews add constraint landscape_reviews_report_object check (jsonb_typeof(report) = 'object');
alter table public.landscape_reviews drop constraint if exists landscape_reviews_model_length;
alter table public.landscape_reviews add constraint landscape_reviews_model_length check (length(model) between 1 and 100);

-- At most 200 reviews per account, as in the app, on any of its ideas. Saves
-- for the same account are checked one after another, so two at once can't
-- both take the last place. Reviews were once also limited per idea (3); that
-- trigger and function go when this runs again.
drop trigger if exists landscape_reviews_per_idea on public.landscape_reviews;
drop function if exists public.limit_reviews_per_idea();
create or replace function public.limit_reviews_per_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('landscape_reviews_per_account:' || new.user_id::text, 0));
  if (select count(*) from public.landscape_reviews where user_id = new.user_id) >= 200 then
    raise exception 'An account can keep at most 200 competition reviews. Delete some to make more.'
      using errcode = 'check_violation', constraint = 'landscape_reviews_per_account';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_reviews_per_account() from public, anon, authenticated;
drop trigger if exists landscape_reviews_per_account on public.landscape_reviews;
create trigger landscape_reviews_per_account before insert on public.landscape_reviews
  for each row execute function public.limit_reviews_per_account();

alter table public.landscape_reviews enable row level security;
revoke all on public.landscape_reviews from anon, authenticated;
grant select, insert, delete on public.landscape_reviews to authenticated;

drop policy if exists "Own reviews: read" on public.landscape_reviews;
create policy "Own reviews: read" on public.landscape_reviews
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

drop policy if exists "Own reviews: add" on public.landscape_reviews;
create policy "Own reviews: add" on public.landscape_reviews
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_invited()) and public.owns_idea(idea_id));

drop policy if exists "Own reviews: delete" on public.landscape_reviews;
create policy "Own reviews: delete" on public.landscape_reviews
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_invited()));

-- ---------- Invite-only sign-up ----------

-- Supabase calls this before creating any new account (Google included).
-- Emails not on the invite list are turned away and no account is created.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_email text := lower(event -> 'user' ->> 'email');
  provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  -- The app signs in with Google only (invited_account): a sign-up any other
  -- way, such as an email and password, is turned away even for an invited
  -- address. When Supabase doesn't say how, invited_account still decides.
  if provider is not null and provider <> 'google' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This app signs in with Google only.'));
  end if;
  -- A sign-up without an email, or with letters outside ASCII (a lookalike of
  -- an invited address), never matches an invite.
  if public.plain_email(event -> 'user' ->> 'email') and exists (select 1 from public.invites where email = new_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This app is invite-only. Ask the owner to invite ' || coalesce(nullif(new_email, ''), 'your email') || '.'
    )
  );
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.invites to supabase_auth_admin;
