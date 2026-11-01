# Security policy

## Reporting a vulnerability

1. Open the repository's **Security** tab and click **Report a vulnerability** or notify maintainer.
2. Describe the problem, the steps to reproduce it, and what an attacker could do with it. Include the browser, the URL and the account type (signed in, invited or not) if they matter.

What happens next:

- You'll get a reply.
- If the problem is confirmed, it is fixed on `main`, which deploys straight away. You'll be told when it is fixed.
- If it isn't treated as a vulnerability, you'll get the reason.

## In scope

- The web app: [`index.html`](index.html), [`src/`](src/) and the security headers in [`_headers`](_headers).
- The Worker, [`worker.mjs`](worker.mjs): published landing pages (`/p/…`), `/api/generate`, `/api/chat` and `/api/landscape`.
- The database rules in [`supabase/schema.sql`](supabase/schema.sql): row-level security, the invite-only sign-in hook, and the functions anyone may call.

Examples of what counts:

- reading or changing another person's ideas, drafts or landing pages;
- signing in, or using `/api/…`, without being invited;
- running a script in the app, or in a published landing page;
- getting someone's model API key out of their browser, or out of the Worker.

## Out of scope

- **The Supabase publishable key and project address in [`src/config.js`](src/config.js).** They are public by design; the database rules decide what each person can read and change.
- **Keys and conversations kept in the browser.** Landing page keys, Coach keys and Coach history are stored in the browser's local storage on purpose, as the [privacy page](privacy.html) explains. A report needs a way for another site or person to read them.
- **What a model writes.** A landing page or Coach answer you don't like, made up or wrong, isn't a vulnerability. Ways to get past the page sandbox or the Markdown escaping are.
- **Problems in Cloudflare, Supabase, Google sign-in or the AI providers.** Report those to them.
- **Denial of service, load testing, spam, social engineering and physical attacks.**
- **Missing best practices with no attack behind them,** such as a header that could be stricter.
- **Vulnerable development tools.** These are tools that never reach the site, such as `wrangler` or Playwright.

## Testing rules

- Use your own account and data. Don't read, change or delete anyone else's.
- Don't send automated scans or a high volume of requests to the live site.
- Stop and report as soon as you have shown the problem. Don't keep access or go further than you need to.

Testing in good faith within these rules is welcome, and won't be treated as an attack.
