# Film Lab

The private film logbook at **`/photography/lab`**: passkey sign-in (phase 1), the
inventory (phase 2: cameras, lenses, film stocks, labs, and every roll from the fridge to
the negative binder), shooting mode on the phone (phase 3: per-frame logging that works
with no signal, QR roll labels, rewinding part-way), and the way back to the portfolio
(phase 4: logged settings in the public film desk's lightbox, a Publish button, and
`upload-film --roll`).

## The pages

| Page | What it's for |
| --- | --- |
| **Light table** (`/photography/lab/`) | What's loaded in each camera, and "the line": six columns, one per stage. Drag a roll to its next stage on a laptop, or tap its → button. Every move records a date and has an Undo. |
| **Rolls** | Every roll, filterable by stage and searchable. Each roll's page has its timeline (dates are editable), its details, and its scans on the public desk. |
| **Fridge** | Unshot film, as canisters on shelves grouped by where they're kept ("Fridge door"). Oldest expiry first, with the usual rule of thumb for expired film. Below it, the film stock catalogue (ISO, process, format). |
| **Gear** | Cameras (mount or fixed lens, battery, service log) and lenses grouped by mount, with which cameras each fits. |
| **Shoot** (`/photography/lab/shoot/`) | The phone screen for logging frames while you shoot. See below. |
| **Labels** (`/photography/lab/labels/`) | Printable QR stickers for canisters and camera backs. The phone's own camera opens them: shooting mode if the roll is loaded, otherwise its page (`/photography/lab/r/R-031`). |
| **Labs** | Shot rolls waiting to be sent: tick a batch, pick the lab, mark them sent, and print a slip with each roll's process and push/pull. Lab cards show typical turnaround once rolls go from "sent" to "scans in". |

The six stages: **In storage → In camera → Shot → At the lab → Scans in → Negatives home**
(plus **Lost or ruined**). Rolls get codes like `R-023`, short enough to write on the
canister.

## Shooting mode

Open **Shoot** (or a roll's "Log frames") on your phone. It opens on the camera you loaded
most recently; with more than one loaded, chips at the top switch between them.

- **Counter:** the next frame, like the window on the camera's top plate. − / + fix it if
  you skipped logging a frame.
- **Dials:** aperture (from the lens's widest) and shutter speed. "A" means the camera
  chose. Point-and-shoots start on "Exposure set by the camera". Settings carry over from
  the roll's last frame, so most frames are one tap.
- **Lens:** only lenses on the camera's mount are offered; with one, it's preselected.
  Zooms ask for the focal length.
- **Location:** rough, rounded on the phone to about 100 m before it's saved. Toggle it off
  per session.
- **Log frame:** saves to the phone first, then syncs. Undo is in the toast. Tap a logged
  frame to fix its note or number, or delete it. The roll page has the full list (edit,
  delete, or add frames after the fact, without a time).
- **Roll finished / Rewound early:** a rewound roll goes back to the fridge marked "partly
  shot". Loading it again reminds you to wind on past the last frame plus a spare, and
  the counter starts there.
- **Safelight** (bulb icon): red on black, so your eyes stay used to the dark.
- The screen stays on while shooting mode is open (where the browser allows it).

**No signal.** Everything you log goes into an outbox on the phone (IndexedDB) and syncs
as soon as the server answers. The top corner says "Offline · 5 waiting" until then. The
lab's pages are kept on the phone by a service worker (`public/photography/lab/sw.js`,
scoped to `/photography/lab/` only), so shooting mode opens with no signal as long as it
was opened once with one. Signing out clears those saved pages. If anything hasn't synced,
it warns you first.

**Install it.** In Safari: Share → Add to Home Screen. In Chrome: the install link at the
bottom of shooting mode. It opens straight onto shooting mode, full screen, with its own
icon. On iPhone, a home-screen app keeps its own sign-in, so sign in once inside it (your
Bitwarden passkey works there too).

**Bringing in the film desk.** On an empty logbook the light table offers to import the
public film desk: every camera, stock and lab in `film-labels.json` becomes gear, and every
desk roll becomes a roll filed under "Negatives home", linked to its scans (in develop
order, R-001 onward). Running it again only adds what's new. For a roll you logged before
uploading its scans, link them from the roll's page (or in the "Scans arrived" step) instead
of importing, which would make a duplicate.

**New names on the desk.** When `film-labels.json` gains a camera, stock or lab (say
CineStill 800T), the Fridge page offers to add it to your logbook. A stock you already
added by hand with the same name is matched to it rather than duplicated.

The rest of the site is unchanged and still fully prerendered. Only the lab's pages and
`/api/auth/*` run as a Vercel function (through `@astrojs/vercel`), so visitors never touch
the database.

## On the portfolio

Every roll that's on the public film desk has an **On the portfolio** card on its page.
It decides what the desk's lightbox shows for that roll's scans:

- **Exposure:** aperture, shutter, lens (or focal length) and the speed the roll was
  rated at (the box speed unless it was pushed or pulled).
- **Frame notes** as captions, on scans that have no caption of their own.
- **Place to show:** one place, in your words, for the whole roll ("Durham, NC"). A
  frame's GPS position never leaves the lab.

All three start off. The card previews the line as the lightbox will show it. Only the
owner's rolls reach the portfolio.

**Lining frames up with scans.** Scans rarely start at frame 1: labs scan frame 0 or 00,
or skip a blank. The strip on the roll's page shows the logged settings under each scan.
**Scan 1 is frame ‹ N ›** shifts the whole roll until they match, and the count beside it
("5 of 5 logged frames line up") says how many logged frames land on a scan. For a
one-off, like a blank skipped mid-roll, edit that frame in the Frames table and pin it to
its scan. A pin wins over the shift.

**Publishing.** The film desk is prerendered, so changes go live when the site rebuilds.
Save the card, then press **Publish to portfolio**. It calls a Vercel deploy hook (see
step 6 of *Going live*), and the desk shows the change a minute or two later. You can
publish once a minute. In `npm run dev` there's nothing to publish: the desk reads the
local logbook on every page load.

`src/lib/lab/server/published.ts` does the reading while `/photography/` is built. On
Vercel it reads production. A plain local `npm run build` skips it, so a build on your
laptop never reaches production; `FILM_LAB_BUILD_DATA=1 npm run build` opts in (and
reads whatever `TURSO_DATABASE_URL` points at). If the read fails or takes longer than
8 seconds, the desk builds without it and the build log says why.

### Uploading scans for a logbook roll

```bash
npm run upload-film -- ~/Downloads/scans --roll R-047 --dry-run
npm run upload-film -- ~/Downloads/scans --roll R-047 [--developed 2026-11-08] [--title "Eno River in fog"]
```

With `--roll` the folder can have any name. The camera, stock and lab come from the
logbook roll, and so does the title (or "R-047 · Kodak Gold 200" when the roll has none).
The developed date is `--developed`, else the day the roll reached "Scans in", else
today. After uploading, it links the roll to its new desk roll and moves it to **Scans
in** if it wasn't there yet. A camera, stock or lab you added by hand gets a folder token
made from its name, saved back to the logbook.

It reads the logbook from `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.
`FILM_LAB_UPLOAD_DB=file:.data/film-lab.db` points it at the local database instead.
`--dry-run` reads the scans but uploads, writes and links nothing.

## Running it locally

```bash
npm run db:migrate   # creates .data/film-lab.db (gitignored)
npm run dev
```

Open `http://localhost:4321/photography/lab/setup/`, enter the setup code `film-lab-dev`,
your name and email, and save a passkey. Passkeys work on `localhost` in Chrome and Safari.

`npm run dev` never touches production, even with the production Turso and auth values in
`.env`: it always uses the local SQLite file, `localhost`, and the `film-lab-dev` setup code.
To browse the real database locally, start it with `FILM_LAB_DEV_DATABASE=remote npm run dev`.
Your timo3.dev passkeys won't sign in on localhost, though.
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
2. **Migrate it.** Put the URL and token in `.env.production` or `.env` (both gitignored):

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

6. **The Publish button.** In Vercel, open Project → Settings → Git → **Deploy Hooks** and
   create a hook for the `main` branch (call it "Film Lab publish"). Add its URL as
   `VERCEL_DEPLOY_HOOK_URL` (Production, marked sensitive), then redeploy. Until then,
   Publish says it isn't set up. Anyone with the URL can trigger a rebuild, so keep it
   out of the repo. Previews never publish.

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
| `src/actions/index.ts`                | every logbook write (Astro Actions)                          |
| `src/lib/lab/server/inventory.ts`     | logbook reads, desk import helpers, lab turnaround           |
| `src/lib/lab/inventory.ts`            | shared types, stages, dates, money, push/pull, expiry        |
| `src/lib/lab/offline.ts`              | the phone's outbox (IndexedDB) and its sync                  |
| `src/lib/lab/alignment.ts`            | which frame each scan is, and what a frame shows publicly    |
| `src/lib/lab/server/published.ts`     | the build-time read of what the film desk shows              |
| `scripts/lib/logbook.mjs`             | the logbook lookups behind `upload-film --roll`              |
| `public/photography/lab/`             | service worker, web app manifest, icons                      |

## Changing the schema

Edit `schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then run
`npm run db:migrate` (local) and `npm run db:migrate:prod` (Turso; it reads
`.env.production`, or `.env`). **Migrate production before deploying code that needs the
new tables**, or the lab pages fail until you do. `npm run db:studio` opens a browser for
the local database.

Writes go through Astro Actions in `src/actions/index.ts` (`actions.lab.*`). Each checks
the session and that every id it touches belongs to the signed-in user. Reads for pages
live in `src/lib/lab/server/inventory.ts`; shared types and formatting in
`src/lib/lab/inventory.ts`.
