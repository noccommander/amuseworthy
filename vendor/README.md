# Vendored libraries

| File | Package | Version | License |
|---|---|---|---|
| `supabase-js-2.117.2.js` | [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) (`dist/umd/supabase.js`) | 2.117.2 | MIT |

Kept in the repo so the app needs no CDN. Its MIT licence, from the same package, is `LICENSE-supabase-js.txt`, and is published with it. It is only loaded when `src/config.js` has a Supabase project filled in.

## Checksums

The file is `dist/umd/supabase.js` from the npm package, unchanged; its SHA-256 is recorded below, so any change to it also has to change this line, where a review can see it. The same version is a dev dependency in `package.json` (never published), and `npm ci` installs it only when the package matches the integrity in `package-lock.json`, so the two can be compared byte for byte.

- File SHA-256: `59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd`
- npm package integrity (`@supabase/supabase-js@2.117.2`): `sha512-eSG2VKnHR+Clp1PmidZ1/weJ8PJwoybjva3L2GgKqFG4YDS1Iqmc61psKGZP5xw6OMT2O7ZorPR42PY6q1BOXg==`

To update it: download the new version's package (`npm pack @supabase/supabase-js@<version>`), check that its integrity matches `npm view @supabase/supabase-js@<version> dist.integrity`, copy `package/dist/umd/supabase.js` here under the new version's name (and `package/LICENSE` over `LICENSE-supabase-js.txt`), change `LIBRARY` in `src/cloud.js`, run `npm install --save-dev --save-exact @supabase/supabase-js@<version>`, and update the table and both checksums above.
