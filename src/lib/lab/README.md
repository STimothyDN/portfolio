# Film Lab

The private film logbook at **`/photography/lab`**: passkey sign-in (phase 1), the
inventory (phase 2: cameras, lenses, film stocks, labs, and every roll from the fridge to
the negative binder), shooting mode on the phone (phase 3: per-frame logging that works
with no signal, QR roll labels, rewinding part-way), and the way back to the portfolio
(phase 4: logged settings in the public film desk's lightbox, a Publish button, and
`npm run ingest --roll` in film-labs), and insight (phase 5: a light meter, reciprocity timer and zone
focus on the phone; search across every frame; what your scans say about your cameras,
film and labs; cost per frame; pace and restock forecasts; and a "loaded now" line on the
film desk).

## The places

Three places and a shutter button, in the dock (a strip of film along the bottom of every
page; ⌘K, Ctrl+K or `/` opens a finder for any place, roll or next move).

| Place | What it's for |
| --- | --- |
| **The bench** (`/photography/lab/`) | Everything in motion on one surface, laid out as a roll's loop: **fridge → cameras → shot → at the lab → light table → binder**, with the verbs printed on the mat between stations. A roll is a physical thing at each stage (a canister, film across a camera's gate, a loose canister, an envelope, a strip of negatives, a sleeve). Drag it to where it goes next, or tap it for its menu; the drop target fills in what the slip used to ask (which camera, which lab), you confirm, and it flies there. Every move has an Undo. The **Today** card ranks the few things worth doing next (`nudges.ts`); **Annotate** (`A`) numbers every object and lists its readouts (pace, idle days, months of film, when scans should be back). On wide screens the whole bench fits one screen; on phones and small windows it's a column. |
| **Fridge**, **Kit**, **Post** (`/fridge/`, `/gear/`, `/labs/`) | Close-ups of the bench: the station fills the mat and the rest shrinks to a mini-map at the side (the station grows into place as you open it). Fridge: unshot film by shelf, oldest dates first, restock forecast, the stock catalogue. Kit: cameras (battery, service log) and lenses by mount. Post: send a batch (drop-off or mail, tracking, prints), envelopes on their way, negatives coming back, your labs. |
| **The binder** (`/photography/lab/rolls/`) | Every roll. **The line**: each roll as a ribbon in its film's colour on one time axis, running through its camera's lane, then waiting, at a lab, scans in, filed; drag across it to pick a stretch of time. Above it, the average roll (median days at each stage). Below, the **sheets**: a glassine sleeve per roll with its best frames showing through, stage tabs, search, a list view. |
| **A roll** (`/photography/lab/rolls/R-021/`) | The roll as a sleeve page: its lifeline (the six stations, dated; click a date to fix it) and next step in the head, a report card (yield, keepers, density against the same film elsewhere, cost per frame, days per stage), the scans in strips of six (negative or positive), and a close-up of any frame (the scan, what it was shot at, when, a density gauge, and **grease-pencil marks**: 1–5 or ✕, keys work). Details and sharing below. |
| **Frames** (`/photography/lab/frames/`) | **The field**: every logged frame as a dot, re-arranged by exposure (aperture × shutter, lines of equal light), light × density, time of day, or roll by roll, coloured by film, camera or density. Then the contact sheets, search and map. |
| **The almanac** (`/photography/lab/almanac/`) | What it all adds up to. See *Insight* below. |
| **Shoot** (`/photography/lab/shoot/`) | The phone screen for logging frames while you shoot (the shutter button in the dock). A pre-flight strip says frames left, the pace and one thing worth knowing about the camera; when a roll comes out it offers the next one from the fridge. See below. |
| **Labels** (`/photography/lab/labels/`) | Printable QR stickers for canisters and camera backs. The phone's own camera opens them: shooting mode if the roll is loaded, otherwise its page (`/photography/lab/r/R-031`). |
| **Darkroom** (`/photography/lab/darkroom/`) | Developing at home (the bench's **Darkroom** tool). Pick the rolls going in the tank and a recipe (yours, or a starting point from the makers' data sheets with its source), say how warm the developer is, and a timer runs every step: the developer time adjusted for temperature (black and white, 18–24 °C) and for rolls already through a reusable kit (Cs41: +2% a roll), each agitation called with a tone and a buzz, the screen kept awake (the page is saved for offline like the bench, so the timer runs with no signal; recording the run needs a bar). Finishing records the run on each roll (`roll.dev_run`) and moves it to **Developed at home** (a lab marked `home`, made the first time). The **chemistry shelf** counts rolls through each batch and warns when it's nearly spent or past its keeping time. Maths in `src/lib/lab/darkroom.ts`. |
| **Trip planner** (`/photography/lab/trip/`) | Where (looked up by name on Open-Meteo's geocoder; only the name is sent), when and which cameras. Each day's light (the forecast within 16 days, sun times every day, in the destination's time), how much film at the pace you shoot on a day out (minus what's left in the cameras, plus a spare), the speed mix that light asks for, which rolls in the fridge to bring (one tap moves them to a "Trip: …" shelf), and checks: old batteries, empty cameras, x-rays when flying. Trips save. Sums in `src/lib/lab/trip.ts`. |
| **Contact sheet** (`/photography/lab/rolls/R-021/sheet/`) | A roll's scans in strips of six on black paper, edge numbers, each frame's settings and notes, grease-pencil marks; positive or negative, Letter or A4; download as PNG or print. With no scans, a shooting log of the logged frames. Drawn on a canvas (`src/lib/lab/contact-sheet.ts`); the CDN allows cross-origin reads, so it exports. |

**The look: the maker's side of the film desk.** The desk shows prints under room light;
the lab shows the same rolls still in motion, under transmitted light. One lamp (top
right) casts every shadow, and anything you pick up rises toward it. By day the bench is a
cutting mat on a warm table; at night it's under the safelight. Moving between places
winds the film (the page slides through the gate); a roll opened from the binder lifts
toward you; a close-up grows out of its station. Every motion is a plain fade under
"reduce motion". Shared styles live in `src/styles/lab/`; the motion kit (drag with a
long press on touch, carrying an object across a change of shape, FLIP) in
`src/lib/lab/motion/`; the objects (canister, camera top, envelope, negative strip,
sleeve, binder, Today card) in `src/components/lab/objects/`.

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

**Lenses on rolls.** Loading a roll into a camera with a mount asks which lens is on it (the one it last shot with comes first; `roll.lens_id`). Shooting mode starts on that lens, frames that don't name one count as shot through it (roll page, Frames page, the film desk's lightbox), and the roll page names every lens the roll went through.

**Batteries.** A camera's battery is written as cells and type ("2 × LR44"; `batteryOf` reads the variants, and sizes that stand in for each other share a compartment: SR44 and 357 count as LR44). The Kit page's **battery box** keeps spares by type, shows which cameras take each and how old their set is (18 months counts as old), and **Swap in fresh** logs the swap and takes the cells out of the box (deleting the entry puts them back). The Today card speaks up when a loaded camera's set is old and the box can't cover it; the trip planner checks the cameras going along. Maths in `src/lib/lab/batteries.ts`.

**Shutter ranges.** A camera's fastest and slowest speeds (Kit page; known models such as the X-700 fill in from `KNOWN_SHUTTERS`) limit shooting mode's dial and the meter's suggestions.

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

- **Meter:** pick the **scene** (Auto, or one of 26: bright sun to under trees, snow,
  backlit, landscape, portrait, golden hour, sunset, blue hour, lit streets, neon,
  campfire, the moon, fireworks, window light, stage, candlelight…). With no photo, the
  reading comes from the sun's height where you are (the observatory's sun math,
  `src/scripts/sky/astro.ts`) and the weather (Open-Meteo, keyless; only a position
  rounded to about a kilometre is sent, reused for 15 minutes); daylight scenes such as
  shade, snow and backlight are worked out from that sky, the rest from the standard
  exposure tables. **Take a reading** opens the phone's back camera (or **From photos**):
  tap what you want to meter for a spot (about 5°), drag for an area, or let it read the
  whole frame centre-weighted, then say what the spot is (mid-tone, lighter or deeper
  skin, shadow detail, snow, sky, a lit sign, the brightest detail…). The meter places
  that tone where it belongs (skin a stop over, shadow detail two under, snow two over,
  highlights where the film still holds them) and gives settings for the lens and the
  dials, led by what the scene wants (deep focus for landscapes, wide open at night,
  zone focus on the street), with one-over-the-focal-length hand-holding and a braced
  option. It also shows where the scene's shadows and highlights land on the Zone scale
  against what this film holds, false colour over the photo, notes with one-tap fixes
  ("give ⅔ more", "use the 85B"), a bracket when there's doubt, the sum behind the number,
  a filter on the lens, an adjustment, and tips for the scene. Point-and-shoots get the
  reading and advice ("use the backlight button") instead of settings.
- **Long exposure:** metered time → time to expose, with each stock's reciprocity
  (Ilford's published formulas; common estimates for the rest, labelled as such), and a
  bulb timer that counts down with beeps and vibration, or counts up.
- **Focus:** hyperfocal distance and sharp zones for the lens on the camera at the
  aperture on the dial (35mm and 120 circles of confusion), in metres and feet.
- **Sun:** today's blue hour, golden hours, sunrise and sunset, in your time zone.

With no signal, the meter falls back to the last weather reading (up to 3 hours old), then
to picking the light yourself; a photo reading works anywhere (it never leaves the phone).

**How a photo becomes a reading** (`src/lib/lab/meter/`): `exif.ts` reads the exposure the
phone wrote into the JPEG (shutter, aperture, ISO, its brightness value, its 35mm focal
length), so the reading is absolute: camera EV at ISO 100 = log2(N²/t) − log2(ISO/100).
`luma.ts` turns a 320-pixel copy into scene stops: sRGB to linear light, Rec. 709
luminance, then the phone's tone curve undone (an inverse filmic curve: phones add a
little mid-tone contrast and squeeze about four stops of highlights into the top of the
range), plus a third of a stop between where a JPEG puts middle gray and where a
K = 12.5 reflected meter does. Spots and areas average in linear light, as a meter does;
anything the phone clipped is flagged, and the reading becomes "at least" (or "at most").
When the film camera's lens is known, its frame is drawn on the phone's wider picture
and the whole-frame reading uses only that. A photo without exposure data is pinned to the
scene's typical light and said to be an estimate. `advise.ts` does the judgement: the
reading minus each stop of extra light (the tone's place, a third more for negative film
unless the roll is already rated slower or has compensation, the filter's factor, your
adjustment, the roll's compensation) is the exposure, and each tone's landing zone is its
reading minus that. `scenes.ts` holds the scenes, tones, filters and each film's latitude
(slide about 4 stops, Portra about 8½; pushing costs shadows). Phones differ by up to half
a stop: **Calibrate this phone** stores an offset on the device.

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
public film desk: every camera, stock and lab the desk names becomes gear, and every
desk roll becomes a roll filed under "Negatives home", linked to its scans (in develop
order, R-001 onward). Running it again only adds what's new. For a roll you logged before
uploading its scans, link them from the roll's page (or in the "Scans arrived" step) instead
of importing, which would make a duplicate.

**New names on the desk.** When the desk gains a camera, stock or lab name (say
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


### With no signal

The whole shooting workflow works offline and syncs when there's a bar again:

- **Load a roll** right in shooting mode (＋ Load, or the fridge's next rolls when nothing's
  loaded): film, camera, rated speed, comp. Log frames, finish or rewind, load the next.
- **The bench** works too: a load, finish, send, scans-in or filing slip with no signal
  queues the move ("Saved on this phone; it syncs when there's signal") and the bench
  shows a "waiting to sync" count. (Linking scans and undo need signal.)
- Every move and frame goes into one outbox (`src/lib/lab/offline.ts`, IndexedDB), and
  replays **in the order it happened** (a roll loaded offline is loaded before its frames
  arrive, finished after them). Pages opened offline lay queued moves over the copy the
  phone saved (`applyPending`), so they always show the truth. A move replayed after it
  had already landed is accepted as done.
- Dates come from the device, not the saved page.
- With signal, the bench asks the service worker to save the bench and shooting mode with
  every script, stylesheet and font they load (`save-for-offline` in `sw.js`), so they open
  offline even if this phone never opened them. Tests: `offline`, `offline-cold`.
## Insight

The **almanac** (`src/lib/lab/server/almanac.ts`, pure maths in `src/lib/lab/stats/`,
tested with `npm test`) leads with what stands out, each a sentence with its numbers and
sample size, then nine chapters, each a question with the figure that answers it, a
table view, and one link to act on it. With too little data a figure says what it needs.

1. **The life of a roll**: days at each stage (every roll a dot, the middle half shaded),
   and what piled up week by week.
2. **Exposure**: which light gives you thin negatives (logged frames' light against
   their scan's density), and cameras and labs **compared on the same film** (a camera
   whose rolls all went to one lab is flagged, since the lab may be part of it). Every
   desk scan carries its measured tone; a thin negative scans with raised blacks.
3. **Film for the light**: per film speed, the light you shot in against what that speed
   can hold by hand (f/2 at 1/30 to f/16 at 1/1000), and the speed that would fit best.
4. **Keepers**: the share of scans you rate four stars or more (your marks first, then the
   upload rating) by camera, film, lab and position on the roll, each with a 95% Wilson
   interval; cost per keeper.
5. **Rhythm**: hour of day, day of week, rolls per month, what you load.
6. **Kit**: per camera, rolls, frames back, frames lost a roll, days empty, cost a roll,
   density on the same film; per lens, the apertures you use.
7. **Labs**: turnaround (every roll a dot) and when scans would be back if sent today.
8. **Money**: month by month (film when bought, lab when sent), this year, the projection
   to December, cost per frame by film.
9. **Shelf life**: each roll in the fridge at its date against when you'd reach it.

The same numbers turn up where the decision is made: the send slip shows each lab's
return window, envelopes on the bench flag a lab running late, shooting mode warns when a
camera's negatives tend to come back thin.

Searches on the Frames page read settings, flags and dates as such: `f/1.7`, `1/500`,
`flash`, `noted`, `scanned`, `thin`, `mapped`, `R-021`, `october`, `2026-10`. Every other
word must appear on the frame (stock, camera, lens, roll title, note). The search stays in
the address (`?q=`). The map uses OpenStreetMap tiles (greyed; the tile server sees which
area you're looking at).

**Marks reach the portfolio.** Grease-pencil marks (table `scan_mark`, migration
`0006_marks.sql`) set how close to the top of the film desk's pile each print lands, from
the next publish (read at build time with the rest, `publishedMarks()`).

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

**Suggested alignment.** Many labs print each frame's edge number into the scan's file name (`…-R1-005-1.jpg` is frame 1, `-00` is frame 00). When they do, the strip suggests the alignment from the names, including pins for any frame the lab skipped; otherwise it compares each logged setting's light with how bright its scan came out and suggests a shift when one clearly wins. **Line them up** applies it in one write (`applyAlignment`). `suggestAlignment` in `alignment.ts`.

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

The film desk now comes whole from Film Labs (`GET /v1/public/desk`, read by
`src/utils/film.ts` when `/photography/` is built), and Film Labs rebuilds the site by
itself when the desk changes; Publish is still there to force one.

### Uploading scans

Scans are ingested in the film-labs repo (`npm run ingest -- <folder> --roll R-047`),
which uploads them, saves the roll on the film desk, links it, and rebuilds this site.
`npm run upload-film` here only points there.

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

### Tests

`npm test` runs the almanac's maths, the photo meter's, and the kit's (batteries,
shutter ranges, alignment suggestions, darkroom, trip planner) with vitest
(`src/lib/lab/stats/stats.test.ts`, `src/lib/lab/meter/meter.test.ts`, `src/lib/lab/kit.test.ts`). The
browser tests drive headless Chrome over CDP with a virtual passkey, against
`npm run dev` (which only ever uses the local database). Most start by claiming the lab,
so empty the local logbook first:

```bash
node scripts/lab-harness/reset-db.mjs && node scripts/lab-harness/run.mjs bench
```

Modules: `bench`, `binder`, `almanac`, `kit` (shutter ranges, the battery box, lenses on rolls, suggested alignment, the darkroom, the trip planner, contact sheets, the bench at laptop sizes), `meter` (the photo meter, with a generated scene
carrying iPhone-style EXIF), `offline`, `smoke`, `p2`–`p6`, `audit` (five widths, empty
and full), `perf`, and `seed` + `look` (screenshots; `LOOK=home,rolls VIEWS=light,phone`).
Output goes to `.data/harness/` (`LAB_OUT` to change it).

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

## Guests

Signed out, anyone can look round **the owner's lab**, live and read-only: the bench and
its close-ups, the binder and every roll, frames and the almanac
(`src/lib/lab/server/guest.ts`). The middleware sets `locals.guest` to the owner, never
`locals.user`, so every write action refuses (they all need `user`); the islands get
`readOnly` and show no controls, and nothing can be picked up. Before a guest page's data
reaches the browser, `forGuest()` blanks where frames were taken and tracking and lab
order numbers. Shooting mode, labels and the account still ask for sign-in. A margin
guide (a column at 100em and wider, a sticky strip otherwise) explains each place and
offers an invite by email (accounts stay invite-only). Signed in, everyone gets their own
lab as before. Test: `node scripts/lab-harness/run.mjs guest`.

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
- **The Lab button on the film desk** shows for everyone. Signed out it opens the owner's
  lab read-only (see *Guests*); signed in, your own.
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
| `src/lib/lab/light.ts`                | EV, Sunny 16 from the sky, dial settings, reciprocity, DoF, sun |
| `src/lib/lab/batteries.ts`            | the battery box: cameras' sets, what's due, what to buy       |
| `src/lib/lab/darkroom.ts`             | recipes, temperature and reuse compensation, agitation, chemistry |
| `src/lib/lab/trip.ts`                 | trip days, film needed, speed mix, rolls to pack, checks      |
| `src/lib/lab/contact-sheet.ts`        | the contact sheet's canvas drawing                            |
| `src/lib/lab/server/darkroom.ts`      | saved recipes, chemistry, the home darkroom, trips            |
| `src/lib/lab/meter/`                  | Photo meter: EXIF, pixels to stops, scenes and tones, advice |
| `src/lib/lab/sky-weather.ts`          | shooting mode's weather reading (Open-Meteo, cached)         |
| `src/lib/lab/insight.ts`              | scan tone by camera, film and lab; thin frames by light      |
| `src/lib/lab/frame-search.ts`         | the Frames search: query parsing and matching                |
| `src/lib/lab/pace.ts`                 | a loaded roll's pace; how fast each stock leaves the fridge  |
| `src/lib/lab/server/frames.ts`        | the Frames page's data (frames, their scans, desk tone)      |
| `src/lib/lab/server/rewind.ts`        | the Today card's Rewind pick                                 |
| `src/lib/lab/tracking.ts`             | carrier from a tracking number's shape, links, status words  |
| `src/lib/lab/server/tracking.ts`      | live status from 17TRACK, cached in `shipment`               |
| `src/components/lab/LabSendFields.vue`| drop-off or mail, tracking, prints (send forms)              |
| `src/styles/lab/`                     | the lab's shared styles and tokens (stage colours, lamp, mat) |
| `src/lib/lab/motion/`                 | drag (long press on touch), carry across shapes, FLIP        |
| `src/components/lab/objects/`         | canister, camera top, envelope, negative strip, sleeve, binder, Today |
| `src/components/lab/bench/`           | the bench, its slips and the close-ups' frame                |
| `src/components/lab/binder/`          | the binder page and the line                                 |
| `src/components/lab/almanac/`, `charts/` | the almanac and its chart kit                             |
| `src/components/lab/frames/`          | the field                                                    |
| `src/lib/lab/server/bench.ts`         | the bench's data (one batch), negative strips                |
| `src/lib/lab/server/binder.ts`, `report.ts`, `almanac.ts` | the binder, a roll's report card, the almanac |
| `src/lib/lab/stats/`                  | pipeline, labs, keepers, light fit, money, rhythm, kit, shelf (+ tests) |
| `src/lib/lab/nudges.ts`               | the Today card's ranking                                     |
| `scripts/lab-harness/`                | browser tests over CDP (`node scripts/lab-harness/run.mjs bench`) |
| `public/photography/lab/`             | service worker, web app manifest, icons                      |

## Moving out

Film Lab is becoming its own project: the `film-labs` repo (API at `lab.timo3.dev/api`,
native apps, and later the web app). Until its web app is ready, the pages here keep
running on the same database, **bug fixes only**. What that means here:

- **The schema belongs to film-labs now.** New tables and columns are added there
  (`packages/server/drizzle/`) and migrated to production from there. Don't run
  `drizzle-kit generate` in this repo; `npm run db:migrate` still sets up the local
  development database with the tables these pages know.
- **Film Labs owns the film desk.** Rolls, scans, names and what the logbook shares come
  from `GET /v1/public/desk` (`FILM_LAB_API_URL`, default production); there are no roll
  files or `film-labels.json` here any more. Scans are ingested in film-labs
  (`npm run ingest`), and Film Labs rebuilds this site when the desk changes.

## Changing the schema

**See *Moving out* above: schema changes now happen in the film-labs repo.** What
follows is how it worked here.


Edit `schema.ts`, run `npm run db:generate`, read the new SQL in `drizzle/`, then run
`npm run db:migrate` (local) and `npm run db:migrate:prod` (Turso; it reads
`.env.production`, or `.env`). **Migrate production before deploying code that needs the
new tables**, or the lab pages fail until you do. `npm run db:studio` opens a browser for
the local database.

Writes go through Astro Actions in `src/actions/index.ts` (`actions.lab.*`). Each checks
the session and that every id it touches belongs to the signed-in user. Reads for pages
live in `src/lib/lab/server/inventory.ts`; shared types and formatting in
`src/lib/lab/inventory.ts`.
