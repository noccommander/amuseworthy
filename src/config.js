// Accounts and cloud sync. Fill in your Supabase project (see README.md) to turn
// on invite-only Google sign-in, with each person's ideas stored in their account.
// Leave both empty to keep ideas in this browser only.
//
// The anon (publishable) key is meant to be public: what each person can read and
// change is enforced by the database rules in supabase/schema.sql.
window.IDEA_CALC_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'sb_publishable_YOUR_KEY',
};
