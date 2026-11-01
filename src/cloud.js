// Google sign-in and idea storage through Supabase. Turned on by filling in
// src/config.js; without it, window.IdeaCloud.enabled is false and the app keeps
// ideas in this browser only.
(function () {
  'use strict';

  const config = window.IDEA_CALC_CONFIG || {};
  const enabled = !!(config.supabaseUrl && config.supabaseAnonKey);
  const LIBRARY = 'vendor/supabase-js-2.117.2.js';
  // Set when this tab starts a sign-in, so an error in the address is only
  // shown to someone who really came back from signing in.
  const SIGN_IN_STARTED = 'ideation-calculator/sign-in-started';
  // What Supabase can put in the address on the way back from signing in.
  const AUTH_FIELDS = ['code', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'expires_at', 'expires_in', 'token_type', 'type', 'error', 'error_code', 'error_description'];
  let client = null;
  // The account this tab shows. Every tab of the browser shares one stored
  // sign-in, and another tab can sign a different account in at any time, so
  // nothing may go out with another account's sign-in. It stays set after the
  // tab leaves the account (a sign-in reloads the page anyway), so a save still
  // on its way when another account signs in is refused too.
  let boundUserId = null;

  function bindAccount(userId) {
    boundUserId = userId;
  }

  // Whose sign-in a request carries: the user id inside its token.
  function tokenUser(headers) {
    const token = (new Headers(headers).get('authorization') || '').split(' ')[1] || '';
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
    } catch {
      return null;
    }
  }

  // supabase-js reads the stored sign-in again as each request goes out, after
  // requireSession has looked, so the account is checked on the request too.
  function boundFetch(url, init = {}) {
    if (boundUserId && new URL(String(url)).pathname.startsWith('/rest/') && tokenUser(init.headers) !== boundUserId) {
      const error = new Error('Signed in as another account in another tab.');
      error.code = 'NO_SESSION';
      return Promise.reject(error);
    }
    return fetch(url, init);
  }

  function takeSignInStarted() {
    try {
      const started = sessionStorage.getItem(SIGN_IN_STARTED) === '1';
      sessionStorage.removeItem(SIGN_IN_STARTED);
      return started;
    } catch {
      return false;
    }
  }

  function loadLibrary() {
    if (window.supabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIBRARY;
      script.onload = resolve;
      script.onerror = () => reject(new Error('The sign-in service could not load. Check your connection and reload the page.'));
      document.head.appendChild(script);
    });
  }

  // After a refused sign-in (for example an email that isn't invited), Supabase
  // sends the person back with the reason in the address. Read it and tidy the
  // address. A link anyone could make carries the same fields, so the reason is
  // only shown when this tab started a sign-in.
  function takeSignInError() {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const started = takeSignInStarted();
    if (!query.has('error') && !hash.has('error')) return null;
    history.replaceState(null, '', location.pathname);
    if (!started) return null;
    return query.get('error_description') || hash.get('error_description') || 'Sign-in was cancelled or refused.';
  }

  async function init() {
    const signInError = takeSignInError();
    await loadLibrary();
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: boundFetch },
    });
    const { data, error } = await client.auth.getSession();
    // Drop sign-in fields from the address once they have been used, so a code
    // or a token never stays in the address bar or the history. That includes
    // tokens in a link this app refuses (it only accepts its own sign-in code).
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (AUTH_FIELDS.some((f) => query.has(f) || hash.has(f))) history.replaceState(null, '', location.pathname);
    return { session: data.session, error: signInError || (error && error.message) || null };
  }

  function signIn() {
    try {
      sessionStorage.setItem(SIGN_IN_STARTED, '1');
    } catch {
      // A refusal then shows no reason, only the sign-in screen.
    }
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
  }

  // Signs out everywhere: Supabase revokes the account's refresh tokens, so
  // every other device is signed out as soon as its sign-in next needs
  // renewing (within an hour), and a sign-in copied from this browser can't
  // be kept alive. Those devices keep the changes they haven't saved yet
  // (keepUnsaved in src/app.js) and save them at their next sign-in.
  // Resolves to whether the other devices were signed out too: when Supabase
  // can't be reached, supabase-js still signs this browser out, but nothing
  // else is revoked. A 401, 403 or 404 means the sign-in had already ended,
  // so there was nothing left to revoke.
  async function signOut() {
    const { error } = await client.auth.signOut({ scope: 'global' });
    return !error || [401, 403, 404].includes(error.status);
  }

  // Without a session, supabase-js sends the publishable key instead, and the
  // database answers as if access had been removed. That happens for a while
  // when a sign-in has expired and can't be renewed (for example offline), so
  // reads and writes wait for a session instead of going out without one. A
  // sign-in for another account counts as none.
  async function requireSession() {
    const { data } = await client.auth.getSession();
    if (!data.session || (boundUserId && data.session.user.id !== boundUserId)) {
      const error = new Error('Not signed in right now.');
      error.code = 'NO_SESSION';
      throw error;
    }
    return data.session;
  }

  // True only when the database says this signed-in person is no longer invited.
  async function accessRemoved() {
    try {
      await requireSession();
      return (await isInvited()) === false;
    } catch {
      return false;
    }
  }

  // Signed out here or in another tab, or another account signed in in another
  // tab (which replaces this tab's sign-in without a sign-out). For the latter,
  // the callback gets the other account's email.
  function onSignOut(callback) {
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') callback(null);
      else if (boundUserId && session && session.user.id !== boundUserId) callback(session.user.email);
    });
  }

  async function isInvited() {
    const { data, error } = await client.rpc('is_invited');
    if (error) throw error;
    return data === true;
  }

  // Every idea, and the version the database holds of each (when its row was
  // last written: id -> updated_at), which saves and deletes are checked against.
  async function loadIdeas() {
    await requireSession();
    const { data, error } = await client.from('ideas').select('id, data, updated_at');
    if (error) throw error;
    return { ideas: data.map((row) => ({ ...row.data, id: row.id })), versions: new Map(data.map((row) => [row.id, row.updated_at])) };
  }

  // One idea as the account has it now, with its version, or null when the
  // account doesn't have it (deleted, or access removed).
  async function loadIdea(id) {
    await requireSession();
    const { data, error } = await client.from('ideas').select('id, data, updated_at').eq('id', id);
    if (error) throw error;
    return data[0] ? { idea: { ...data[0].data, id }, version: data[0].updated_at } : null;
  }

  // Each idea's id and version (id -> updated_at): a few bytes per idea, to see
  // whether anything changed before loading every idea.
  async function loadVersions() {
    await requireSession();
    const { data, error } = await client.from('ideas').select('id, updated_at');
    if (error) throw error;
    return new Map(data.map((row) => [row.id, row.updated_at]));
  }

  // Every write gives the row a new version (the moment it was written), so a
  // save from another tab or device always shows up as a different version.
  // It is always later than the version it replaces, even when this device's
  // clock reads the same moment or is behind.
  const writeTime = (replacing) => {
    const after = Date.parse(replacing);
    return new Date(Math.max(Date.now(), Number.isFinite(after) ? after + 1 : 0)).toISOString();
  };

  // Adds ideas the account doesn't have yet. Returns their versions (id ->
  // updated_at). An id the account already has is refused (23505).
  async function addIdeas(ideas) {
    // A copy as it is now: the ideas can change while the session is checked.
    const rows = ideas.map((idea) => ({ id: idea.id, data: JSON.parse(JSON.stringify(idea)), updated_at: writeTime() }));
    await requireSession();
    const { data, error } = await client.from('ideas').insert(rows).select('id, updated_at');
    if (error) throw error;
    return new Map(data.map((row) => [row.id, row.updated_at]));
  }

  // Saves an idea over `version`, the one this tab last saw. Returns the new
  // version, or null when the account's copy changed or was deleted meanwhile
  // (nothing is written then).
  async function saveIdea(idea, version) {
    const row = { data: JSON.parse(JSON.stringify(idea)), updated_at: writeTime(version) };
    await requireSession();
    const { data, error } = await client.from('ideas').update(row).eq('id', idea.id).eq('updated_at', version).select('id, updated_at');
    if (error) throw error;
    return data[0]?.updated_at ?? null;
  }

  // Deletes an idea if the account still has `version` of it. False when it
  // changed or was deleted meanwhile (nothing is deleted then).
  async function deleteIdea(id, version) {
    await requireSession();
    const { data, error } = await client.from('ideas').delete().eq('id', id).eq('updated_at', version).select('id');
    if (error) throw error;
    return data.length === 1;
  }

  // Each idea's page: idea id -> { slug, publishedAt, draftId, published }.
  // `slug` is the idea's permanent address, which its drafts' addresses start
  // with; publishedAt is when a draft was last made production (null before
  // any was), draftId that draft (null once it is deleted), and `published`
  // whether the production page is up.
  const pageOf = (row) => ({ slug: row.slug, publishedAt: row.published_at, draftId: row.draft_id, published: row.published });
  const PAGE_FIELDS = 'idea_id, slug, published_at, draft_id, published';

  async function loadPages() {
    await requireSession();
    const { data, error } = await client.from('landing_pages').select(PAGE_FIELDS);
    if (error) throw error;
    return new Map(data.map((row) => [row.idea_id, pageOf(row)]));
  }

  // Gives the idea its address, the first time. An idea that has one keeps it
  // whatever `slug` says (the database sees to that, in case another tab or
  // device made it meanwhile), so the page returned has the one stored.
  async function savePageAddress(ideaId, slug) {
    await requireSession();
    const { data, error } = await client.from('landing_pages').upsert({ idea_id: ideaId, slug }).select(PAGE_FIELDS).single();
    if (error) throw error;
    return pageOf(data);
  }

  // Makes a draft the idea's production page and publishes it, at the
  // idea's address.
  async function savePage(ideaId, slug, html, draftId) {
    await requireSession();
    const { data, error } = await client
      .from('landing_pages')
      .upsert({ idea_id: ideaId, slug, html, draft_id: draftId, published_at: new Date().toISOString(), published: true })
      .select(PAGE_FIELDS)
      .single();
    if (error) throw error;
    return pageOf(data);
  }

  // Takes the production page offline, or brings it back as it was.
  async function setPagePublished(ideaId, published) {
    await requireSession();
    const { data, error } = await client.from('landing_pages').update({ published }).eq('idea_id', ideaId).select(PAGE_FIELDS).single();
    if (error) throw error;
    return pageOf(data);
  }

  // Every draft, without its HTML (a few bytes each): idea id -> drafts, newest first.
  const draftOf = (row) => ({ id: row.id, model: row.model, createdAt: row.created_at, code: row.code, published: row.published });
  const DRAFT_FIELDS = 'id, idea_id, model, created_at, code, published';

  async function loadDrafts() {
    await requireSession();
    const { data, error } = await client.from('landing_drafts').select(DRAFT_FIELDS).order('created_at', { ascending: false });
    if (error) throw error;
    const drafts = new Map();
    for (const row of data) {
      if (!drafts.has(row.idea_id)) drafts.set(row.idea_id, []);
      drafts.get(row.idea_id).push(draftOf(row));
    }
    return drafts;
  }

  // A new draft gets a random code for its address from the database, and is published.
  async function saveDraft(ideaId, model, html) {
    await requireSession();
    const { data, error } = await client.from('landing_drafts').insert({ idea_id: ideaId, model, html }).select(DRAFT_FIELDS).single();
    if (error) throw error;
    return draftOf(data);
  }

  async function setDraftPublished(id, published) {
    await requireSession();
    const { data, error } = await client.from('landing_drafts').update({ published }).eq('id', id).select(DRAFT_FIELDS).single();
    if (error) throw error;
    return draftOf(data);
  }

  // One draft's HTML, to make it production.
  async function loadDraftHTML(id) {
    await requireSession();
    const { data, error } = await client.from('landing_drafts').select('html').eq('id', id).single();
    if (error) throw error;
    return data.html;
  }

  // Every saved competition review, without the review itself: idea id ->
  // reviews, newest first.
  const reviewOf = (row) => ({ id: row.id, model: row.model, createdAt: row.created_at });
  const REVIEW_FIELDS = 'id, idea_id, model, created_at';

  async function loadReviews() {
    await requireSession();
    const { data, error } = await client.from('landscape_reviews').select(REVIEW_FIELDS).order('created_at', { ascending: false });
    if (error) throw error;
    const reviews = new Map();
    for (const row of data) {
      if (!reviews.has(row.idea_id)) reviews.set(row.idea_id, []);
      reviews.get(row.idea_id).push(reviewOf(row));
    }
    return reviews;
  }

  // One review, to show it.
  async function loadReview(id) {
    await requireSession();
    const { data, error } = await client.from('landscape_reviews').select('report').eq('id', id).single();
    if (error) throw error;
    return data.report;
  }

  async function saveReview(ideaId, model, report) {
    await requireSession();
    const { data, error } = await client.from('landscape_reviews').insert({ idea_id: ideaId, model, report }).select(REVIEW_FIELDS).single();
    if (error) throw error;
    return reviewOf(data);
  }

  // True if the review was deleted; false if nothing was.
  async function deleteReview(id) {
    await requireSession();
    const { data, error } = await client.from('landscape_reviews').delete().eq('id', id).select('id');
    if (error) throw error;
    return data.length === 1;
  }

  // True if the draft was deleted; false if nothing was (it was gone already,
  // or access was removed, which deletes nothing rather than failing).
  async function deleteDraft(id) {
    await requireSession();
    const { data, error } = await client.from('landing_drafts').delete().eq('id', id).select('id');
    if (error) throw error;
    return data.length === 1;
  }

  // Asks the chosen model's provider for an answer through this site's Worker
  // (worker.mjs), which checks the sign-in and passes the person's own API key
  // on. The answer streams in; `onProgress` hears how far it has got. Returns
  // what streamReader reads (src/landing.js): { content, finishReason, ... },
  // finishReason null when the stream was cut off. A failure has `status`
  // and, when the provider refused, `vendorStatus`. `signal` stops it.
  // `reader` reads the stream (a review's is read by its own, in
  // src/landscape.js). An answer that sends nothing for QUIET_MS (a stalled
  // provider) is stopped, rather than show "Writing…" until someone clicks
  // Stop. A model that thinks for minutes before writing isn't: the Worker
  // sends a keepalive every 15 seconds on every answer's stream, so only a
  // Worker or connection that has gone silent trips it.
  const QUIET_MS = 5 * 60 * 1000;
  async function ask(path, apiKey, body, onProgress, signal, lostText, reader = window.IdeaLanding.streamReader()) {
    const session = await requireSession();
    const lost = () => Object.assign(new Error(lostText), { status: 0 });
    const stopped = () => Object.assign(new Error('Stopped.'), { status: 0, stopped: true });
    const silent = () => Object.assign(new Error('The answer stopped coming for 5 minutes, so it was stopped. Try again.'), { status: 0 });
    const quiet = new AbortController();
    let timedOut = false;
    let timer;
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        quiet.abort();
      }, QUIET_MS);
    };
    const stop = () => quiet.abort();
    if (signal?.aborted) quiet.abort();
    signal?.addEventListener('abort', stop);
    wait();
    let res;
    try {
      try {
        res = await fetch(path, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.access_token}`, 'x-model-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: quiet.signal,
        });
      } catch {
        if (timedOut) throw silent();
        if (signal?.aborted) throw stopped();
        throw Object.assign(new Error("This site couldn't be reached. Check your connection and try again."), { status: 0 });
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        const message = (body && body.error) || `The site answered ${res.status}.`;
        throw Object.assign(new Error(message), { status: res.status, vendorStatus: body && body.vendorStatus });
      }
      const chunks = res.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        for (;;) {
          const { done, value } = await chunks.read();
          if (done) break;
          wait();
          reader.push(value);
          onProgress(reader.progress());
        }
      } catch {
        if (timedOut) throw Object.assign(silent(), { partial: reader.end() });
        if (signal?.aborted) throw Object.assign(stopped(), { partial: reader.end() });
        throw lost();
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
    const answer = reader.end();
    // A provider's error mid-stream, unless the stream says it wasn't one.
    if (answer.error) throw Object.assign(new Error(answer.error), { status: res.status, vendorStatus: 'vendorStatus' in answer ? answer.vendorStatus : 500 });
    return answer;
  }

  const generate = (apiKey, model, messages, onProgress = () => {}, signal) =>
    ask('api/generate', apiKey, { model, messages }, onProgress, signal, 'The connection was lost while the page was being written. Try again.');

  // One turn of a Coach conversation (src/coach.js): `messages` as the
  // Worker's readChat takes them. The answer may end in tool calls
  // (finishReason 'tool_calls'), which the app runs and sends back.
  const chat = (apiKey, model, messages, onProgress = () => {}, signal) =>
    ask('api/chat', apiKey, { model, messages }, onProgress, signal, 'The connection was lost during the answer. Try again.');

  // A review of one idea's competition (src/landscape.js) on the pair of
  // models REVIEW_MODELS keeps under `models`, with the person's key for
  // their provider. The Worker runs it and streams how far it has got, then
  // the review: { report, error, vendorStatus }.
  const review = (apiKey, idea, models, onProgress = () => {}, signal) =>
    ask('api/landscape', apiKey, { idea, models }, onProgress, signal, 'The connection was lost during the review. Try again.', window.IdeaLandscape.reviewReader());

  // The database refuses changes from someone whose invite was removed
  // (Postgres "insufficient privilege").
  const isAccessDenied = (error) => !!error && error.code === '42501';

  // The database refused the data itself (a bad value, a broken constraint, or
  // a request it can't read), so sending the same thing again can't succeed.
  // Other failures, such as a lost connection, are retried.
  const isRefused = (error) => !!error && /^(22|23|PGRST1)/.test(error.code || '') && !isDuplicate(error);

  // The account already has an idea with this id (a save whose answer was lost, say).
  const isDuplicate = (error) => !!error && error.code === '23505';

  window.IdeaCloud = { enabled, init, signIn, signOut, onSignOut, bindAccount, isInvited, accessRemoved, loadIdeas, loadIdea, loadVersions, addIdeas, saveIdea, deleteIdea, loadPages, savePageAddress, savePage, setPagePublished, loadDrafts, saveDraft, setDraftPublished, loadDraftHTML, deleteDraft, loadReviews, loadReview, saveReview, deleteReview, generate, chat, review, isAccessDenied, isRefused, isDuplicate };
})();
