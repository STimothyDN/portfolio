# Film Lab

The private film logbook at **`/photography/lab`**: passkey sign-in (phase 1), the
inventory (phase 2: cameras, lenses, film stocks, labs, and every roll from the fridge to
the negative binder), shooting mode on the phone (phase 3: per-frame logging that works
with no signal, QR roll labels, rewinding part-way), and the way back to the portfolio
(phase 4: logged settings in the public film desk's lightbox, a Publish button, and
`upload-film --roll`), and insight (phase 5: a light meter, reciprocity timer and zone
focus on the phone; search across every frame; what your scans say about your cameras,
film and labs; cost per frame; pace and restock forecasts; and a "loaded now" line on the
film desk).

## The pages

| Page | What it's for |
| --- | --- |
| **Light table** (`/photography/lab/`) | What's loaded in each camera, with its pace ("about 2 frames a day · done around Nov 17"), and "the line": six columns, one per stage. Drag a roll to its next stage on a laptop, or tap its → button. Every move records a date and has an Undo. At the bottom, **Rewind**: a roll developed about a year (or six, three, one months) ago today. |
| **Rolls** | The almanac (charts that filter the list below them, cost per frame, days a roll spends in each camera) and every roll, filterable by stage and searchable. Each roll's page has its timeline (dates are editable), its details, and its scans on the public desk. |
| **Frames** (`/photography/lab/frames/`, the Rolls page's second tab) | Every frame you've logged, as contact sheets with their scans, a search box and a map. Above it, what the scans say about how your negatives come back. See *Insight* below. |
| **Fridge** | Unshot film, as canisters on shelves grouped by where they're kept ("Fridge door"). Oldest expiry first, with the usual rule of thumb for expired film, and how long each stock lasts at the rate you load it (flagging rolls that will pass their date first). Below it, the film stock catalogue (ISO, process, format). |
| **Gear** | Cameras (mount or fixed lens, battery, service log) and lenses grouped by mount, with which cameras each fits. |
| **Shoot** (`/photography/lab/shoot/`) | The phone screen for logging frames while you shoot. See below. |
| **Labels** (`/photography/lab/labels/`) | Printable QR stickers for canisters and camera backs. The phone's own camera opens them: shooting mode if the roll is loaded, otherwise its page (`/photography/lab/r/R-031`). |
| **Labs** | Shot rolls waiting to be sent: tick a batch, pick the lab, say whether it's **dropped off** or **mailed in** (with an optional tracking number for the envelope), the price per roll and whether it includes prints (or what prints cost), and print a slip with each roll's process and push/pull. Mailed rolls show where their envelope is; once scans are in, rolls whose negatives are in the post show under "Negatives on the way back". Lab cards show typical turnaround once rolls go from "sent" to "scans in". |

**The look: a darkroom you walk around.** Each page is a station in one room, and the
room changes with the light: daylight through the studio window by day, the safelight's
amber-red pooling from the corner at night. Moving between stations winds the film: the
page slides out through the gate as the next frame comes in, in the strip nav's order
(opening a roll from its list lifts it toward you instead). A roll on the line takes the
shape it has in real life at each stage: a length of film in the camera, a rewound
canister, a kraft envelope at the lab (airmail-bordered if mailed, postmarked), a
darkroom print once scans are in, a glassine sleeve once it's filed. Loaded cameras show
their top plate with a frame counter that winds up to the frames logged, the box end in
the memo holder and the film across the gate. The fridge door swings open as you arrive
(drawers, door bins and the freezer look the part when their shelf is named that way);
gear sits in a foam-lined case, named on embossed label tape, with a film window and a
lit LED on loaded cameras; labs are business cards, and a roll at the lab travels the road
from home to the lab as its days count toward the usual turnaround. Frames lie on the
light table under a loupe (hover a frame with a mouse). Everything that moves stays still
under "reduce motion". The transition and room styles live in `LabLayout.astro`; each
station's objects live in its own component.

The six stages: **In storage → In camera → Shot → At the lab → Scans in → Negatives home**
(plus **Lost or ruined**). Rolls get codes like `R-023`, short enough to write on the
canister.

**At the lab, two ways.** A roll is either dropped off or mailed in, and the stages say
so. Dropped off: the drop-off date, the day scans arrived, the day you picked up the
negatives. Mailed in: the ship date and an optional outbound tracking number, the day
scans arrived and an optional tracking number for the negatives coming back, and the day
they arrived. A lab remembers how you last sent it film. Each roll also records its
develop-and-scan price, whether that includes prints, and if not, what prints cost (the
almanac counts prints in what a frame costs).

**Rated speed and exposure compensation.** Loading a roll asks the speed it's rated at
(push/pull, for the lab) and any exposure compensation you dial in on the camera (+1,
−0.7: for you, not the lab). Both show wherever the roll's speed does, and shooting
mode's meter builds the compensation into its suggestions.

**Tracking.** Tracking numbers link to their carrier's page (USPS, UPS, FedEx, DHL, told
apart by their shape; anything else opens 17TRACK's universal page). For live status,
make a [17TRACK](https://api.17track.net) API account and add its key as
`TRACKING_17TRACK_KEY` in Vercel (Production). New accounts come with 200 tracking
numbers to use, once; each number you track uses one, the first time it's looked up.
Statuses are kept in the `shipment` table and refreshed at most every two hours until
delivered, after the page loads (pages never wait on 17TRACK). Only numbers on your own
rolls are ever looked up. `npm run dev` ignores the key unless `FILM_LAB_DEV_TRACKING=1`
is set, so tests don't spend numbers.

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

**Light** (the bar under the counter; tap it open):

- **Meter:** a Sunny 16 reading from the sun's height where you are (the observatory's
  sun math, `src/scripts/sky/astro.ts`) and the weather (Open-Meteo, keyless; only a
  position rounded to about a kilometre is sent, and a reading is reused for 15 minutes).
  Or pick the light you see: bright sun to open shade, and a night table (neon, lit
  streets, indoors, candlelight). It offers three settings that fit the lens and the
  shutter dial (everyday, freeze motion, shallow or deep focus); tap one to set the dials.
  It also says how the dials as set compare ("1 stop over, fine on negative film").
  Point-and-shoots get "plenty of light" or "the flash may fire" instead.
- **Long exposure:** metered time → time to expose, with each stock's reciprocity
  (Ilford's published formulas; common estimates for the rest, labelled as such), and a
  bulb timer that counts down with beeps and vibration, or counts up.
- **Focus:** hyperfocal distance and sharp zones for the lens on the camera at the
  aperture on the dial (35mm and 120 circles of confusion), in metres and feet.
- **Sun:** today's blue hour, golden hours, sunrise and sunset, in your time zone.

With no signal, the meter falls back to the last weather reading (up to 3 hours old), then
to picking the light yourself.

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

**Speed.** Lab pages render on a Vercel function next to the Turso database (both US
East), and three things keep navigation feeling instant:

- The moment a finger lands on a lab link (or a pointer rests on one), the page asks the
  service worker to start fetching it, and the tap that follows is answered from that
  copy. Copies are used once and kept at most 15 seconds, and any write (an Astro Action)
  throws them all away first, so a page is never older than your last change.
- Every navigation shows at once that it was heard: the link dims, and if the page takes
  a moment, a strip of film winds across the top.
- Pages send a `Server-Timing` header (session check and total), visible in the
  browser's network panel, for spotting a slow one.

The first visit after a quiet spell waits for the function to start (a "cold start",
about 0.6 s on top). Vercel's **Fluid Compute** (Project → Settings → Functions) keeps
instances warm longer; it's on by default for new projects, worth checking for this one.

The rest of the site is unchanged and still fully prerendered. Only the lab's pages and
`/api/auth/*` run as a Vercel function (through `@astrojs/vercel`), so visitors never touch
the database.

## Insight

The **Frames** page (`src/lib/lab/server/frames.ts`, `src/lib/lab/insight.ts`) starts
with what the scans say. Every desk scan carries its measured tone (black point,
log-average, white point, stored by the uploader). A thin negative scans with grey,
raised blacks, so a high black point is the signal. Film and lab scanning raise blacks
too, so the comparisons are made fairly:

- A **camera** is compared with the same film shot in your other cameras. One that sits
  0.025 or more higher (over at least 20 comparable scans) "comes back thin". If every
  roll from it went to one lab, the finding says the lab may be part of it.
- A **film** that scans flat everywhere is called out as the film's own character, with
  the usual advice to rate it a stop slower.
- A **lab** is compared with your other labs on the same film.
- **Frames you logged** are compared with the rest of their own roll. When thin frames
  cluster in one kind of light (bright, shade and overcast, dim, night), with one lens or
  in one camera, it says so.

Below the findings: the contact sheets (one per roll, unscanned frames tinted by the light
they were exposed for), the search box, and a map of where frames were taken (OpenStreetMap
tiles, greyed; the tile server sees which area you're looking at). Searches read settings,
flags and dates as such: `f/1.7`, `1/500`, `flash`, `noted`, `scanned`, `thin`, `mapped`,
`R-021`, `october`, `2026-10`. Every other word must appear on the frame (stock, camera,
lens, roll title, note). The search stays in the address (`?q=`), so a roll's Frames table
links straight to its contact sheet. At the bottom, a chart of light against density for
logged frames, a "barcode" of every scan's tonal range per camera, and tables by film and
by lab.

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

**Loaded now.** The owner can also show what's in each camera on the film desk ("In the
Minolta X-700: Kodak Portra 400, 22 of 36", above the dock). The switch is on the light
table, under "In the cameras". Like everything here, it goes live with the next publish,
and the frame count is as of that publish.

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
- **The film desk is the owner's.** Importing it, linking scans to it, adding its new
  labels to the logbook, the Frames page's desk-wide findings and the light table's Rewind
  are the owner's alone (the actions refuse anyone else). An invited person's logbook is
  their own film.
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
| `src/lib/lab/light.ts`                | EV, Sunny 16 from the sky, dial settings, reciprocity, DoF, sun |
| `src/lib/lab/sky-weather.ts`          | shooting mode's weather reading (Open-Meteo, cached)         |
| `src/lib/lab/insight.ts`              | scan tone by camera, film and lab; thin frames by light      |
| `src/lib/lab/frame-search.ts`         | the Frames search: query parsing and matching                |
| `src/lib/lab/pace.ts`                 | a loaded roll's pace; how fast each stock leaves the fridge  |
| `src/lib/lab/server/frames.ts`        | the Frames page's data (frames, their scans, desk tone)      |
| `src/lib/lab/server/rewind.ts`        | the light table's Rewind pick                                |
| `src/lib/lab/tracking.ts`             | carrier from a tracking number's shape, links, status words  |
| `src/lib/lab/server/tracking.ts`      | live status from 17TRACK, cached in `shipment`               |
| `src/components/lab/LabSendFields.vue`| drop-off or mail, tracking, prints (send forms)              |
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
