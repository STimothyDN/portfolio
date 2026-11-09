# Film Lab

The private film logbook at **`/photography/lab`**. Phase 1 is the foundation: passkey
sign-in, invites, recovery codes, and an empty light table. Inventory comes next.

The rest of the site is unchanged and still fully prerendered. Only the lab's pages and
`/api/auth/*` run as a Vercel function (through `@astrojs/vercel`), so visitors never touch
the database.

## Running it locally

```bash
npm run db:migrate   # creates .data/film-lab.db (gitignored)
npm run dev
```

Open `http://localhost:4321/photography/lab/setup/`, enter the setup code `film-lab-dev`,
your name and email, and save a passkey. Passkeys work on `localhost` in Chrome and Safari.
To start over, delete `.data/film-lab.db*` and run `npm run db:migrate` again (restart
`npm run dev` afterwards).

`astro preview` doesn't work with the Vercel adapter. To check a production build, use
`npm run build` and look in `.vercel/output/`.

## Going live on timo3.dev

You need a free [Turso](https://turso.tech) account. These are one-time steps.

1. **Create the database.** In the Turso dashboard (or with the `turso` CLI), create a
   database in the region closest to your Vercel functions (Vercel Hobby runs them in
   Washington, D.C., `iad1`, so pick AWS `us-east-1`). Copy its URL (`libsql://…`) and make
   a database token.
2. **Migrate it.** Put the URL and token in `.env.production` (already gitignored):

   ```bash
   TURSO_DATABASE_URL=libsql://…
   TURSO_AUTH_TOKEN=…
   ```

   then run `npm run db:migrate:prod`.
3. **Add Vercel environment variables** (Project → Settings → Environment Variables,
   Production):

   | Name                   | Value                                         |
   | ---------------------- | --------------------------------------------- |
   | `TURSO_DATABASE_URL`   | the `libsql://…` URL                          |
   | `TURSO_AUTH_TOKEN`     | the database token                            |
   | `BETTER_AUTH_SECRET`   | output of `openssl rand -base64 32`           |
   | `BETTER_AUTH_URL`      | `https://timo3.dev`                           |
   | `FILM_LAB_SETUP_TOKEN` | output of `openssl rand -base64 24` (keep it) |

   If previews should work too, add the Turso and secret variables to Preview as well
   (see the note on previews below).
4. **Deploy**, then open `https://timo3.dev/photography/lab/setup/` on your phone. Enter the
   setup code, save the passkey with Face ID, and **save the recovery codes** somewhere
   that isn't your phone.
5. **Add your second device.** On your laptop, sign in with your phone (the browser offers
   "use a phone or tablet" and shows a QR code), or with a recovery code. Then go to
   **Account → Save a passkey on this device**. Passkeys in iCloud Keychain also sync to
   your other Apple devices on their own.

After step 4 the setup code stops working. You can delete `FILM_LAB_SETUP_TOKEN` from
Vercel if you like.

## How sign-in works

- **Passkeys only.** No passwords and no email sending. Better Auth stores sessions in
  the database. Sessions last 30 days and renew while you use the lab. The session
  rides in a signed cookie for five minutes at a time, so most page loads skip the
  database.
- **Nobody can sign up.** An account comes from the setup code (the first, `owner`
  account) or from an invite link the owner makes on the Account page. Invites are single
  use and last a week. Every logbook table will carry a `user_id`, so each person's gear
  and rolls stay separate.
- **Recovery codes.** You get ten at setup and can replace them from Account. Each works
  once, together with your email. The database stores only keyed hashes of them, and
  sign-in attempts are rate-limited.
- **You can't remove your last passkey.** Add another first. This is enforced on the
  server too.
- **Preview deployments** run on `*.vercel.app`. Passkeys are bound to `timo3.dev`, so
  they don't work there, but recovery codes do (if the preview has the env vars).
- **The Lab button on the film desk** shows only on devices that have signed in before.
  It reads a plain, non-secret cookie (`film_lab_device`) that the lab sets. Anyone else
  can still reach the sign-in page at `/photography/lab`, but nothing points to it.
- Lab pages and the auth API send `X-Robots-Tag: noindex` and `Cache-Control: no-store`.

## Where things live

| Path                                  | What                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `src/lib/lab/server/config.ts`        | env vars, base URL, passkey domain and origins               |
| `src/lib/lab/server/auth.ts`          | Better Auth setup                                            |
| `src/lib/lab/server/plugin.ts`        | setup/invite claim, recovery codes, invites, last-key guard  |
| `src/lib/lab/server/db/schema.ts`     | Drizzle schema (Turso / SQLite)                              |
| `drizzle/`                            | generated SQL migrations                                     |
| `src/middleware.ts`                   | guards `/photography/lab/*`, sets the device cookie, headers |
| `src/pages/api/auth/[...all].ts`      | the auth API                                                 |
| `src/pages/photography/lab/`          | lab pages                                                    |
| `src/components/lab/`                 | layout and the Vue islands                                   |
| `src/lib/lab/auth-client.ts`          | browser-side auth helpers                                    |

## Changing the schema

Edit `schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then run
`npm run db:migrate` (local) and `npm run db:migrate:prod` (Turso). Migrate production
before deploying code that needs the new columns. `npm run db:studio` opens a browser
for the local database.
