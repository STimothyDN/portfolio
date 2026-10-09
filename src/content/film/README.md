# Film Rolls

This folder holds one JSON file per **roll of film** (schema in
[`src/content/config.ts`](../config.ts)). Together they power the film desk at
**`/photography/`** (the photography home; digital shoots live at `/photography/digital/`): every scan tossed onto one surface as a messy pile of prints,
which can be dragged around, opened in the lightbox, or filed into rows by camera, film
stock, lab, year, or roll.

Scans live in the same Bunny.net storage zone as the digital shoots, under
`film/<roll-id>/`. This folder only holds the metadata. The one-time `.env` setup is the
same as for shoots (see [`../photography/README.md`](../photography/README.md)).

---

## The folder name is the metadata

Keep each roll's scans in a folder named:

```
<dateDeveloped>_<camera>_<filmStock>_<lab>_<summary>
20261007_minoltax700_fuji400_fotoshoppe_downtowndurham
```

| Part          | Example          | Used for                                   |
| ------------- | ---------------- | ------------------------------------------ |
| dateDeveloped | `20261007`       | sorting, the **Year** filter, the lightbox |
| camera        | `minoltax700`    | the **Camera** filter                      |
| filmStock     | `fuji400`        | the **Film** filter                        |
| lab           | `fotoshoppe`     | the **Lab** filter                         |
| summary       | `downtowndurham` | the roll's title (editable afterward)      |

Tokens can't contain underscores, since underscores separate the parts. Hyphens inside a
token are fine and help the guessed title (`downtown-durham` becomes "Downtown Durham").

## Uploading

```bash
# one roll (optionally naming it)
npm run upload-film -- ~/Pictures/Film/20261007_minoltax700_fuji400_fotoshoppe_downtowndurham --title "Downtown Durham"

# every roll folder inside a folder (rolls already uploaded are skipped)
npm run upload-film -- ~/Pictures/Film

# check names, dimensions and ratings without uploading or writing anything
npm run upload-film -- ~/Pictures/Film --dry-run
```

For each roll this uploads the scans (`.jpg`, `.jpeg`, `.png`, `.webp`; export TIFFs to
JPEG first), writes `src/content/film/<roll-id>.json`, and adds a display name to
[`src/data/film-labels.json`](../../data/film-labels.json) for any camera, film stock or
lab it hasn't seen before. **Check those names and each roll's `title`**, then commit.

Labs often save vertical shots sideways with an EXIF "rotate 90" flag. The uploader
records each scan's size as it actually displays. Rolls uploaded before it did that can
be corrected in place (it only swaps width/height where the CDN serves a scan the other
way round):

```bash
npm run fix-film-orientation -- --dry-run   # see what would change
npm run fix-film-orientation
```

`--force` re-runs a roll that's already uploaded and merges: new scans are added, and
titles, priorities and captions you've edited are kept.

## Display names

Folder tokens are terse (`minoltax700`). The site shows them through
[`src/data/film-labels.json`](../../data/film-labels.json):

```json
{
  "cameras": { "minoltax700": "Minolta X-700" },
  "stocks": { "fuji400": "Fujifilm 400" },
  "labs": { "fotoshoppe": "Fotoshoppe" }
}
```

Rename something once there and every roll using it updates.

Along the bottom of the page each roll is a film canister labeled with its **film stock**
(the display name above, fitted onto up to three lines), with the roll's **title** and
date under the strip of film. Pick a filter or a roll and the frames file into strips of
negatives: each roll spools out of its canister and ends on a leader with the title
written on a lab sticker. Canister colors follow the stock's display name (Kodak
yellow, Fuji green, Lucky red, Ilford white, CineStill black; anything else gets a steady
color of its own).

## Priority: who ends up on top of the pile

Each scan has a `priority` from **1** (usually buried) to **5** (almost always on top):

- The pile only holds a few dozen prints, so it's a weighted draw: each step up in
  priority **triples** a scan's odds of making it onto the desk at all.
- Within the pile, higher priorities stack higher. There's deliberate jitter, so a 4
  sometimes lands on a 5, and the pile is different on every visit.
- Filters ignore priority: filing by camera, roll, etc. shows every matching frame.

The easiest way to set priorities is to **star-rate the scans before uploading** (Lightroom,
Bridge, Capture One, darktable, and Windows Explorer all write the rating into the file).
The uploader turns stars into priority (★1–5 maps to 1–5, rejected maps to 1, and unrated
scans default to 3). You can also edit `priority` in the JSON at any time.

## File format

```jsonc
{
  "title": "Downtown Durham",       // shown on the roll strip and in the lightbox
  "developed": "2026-10-07",        // from the folder name
  "camera": "minoltax700",          // folder tokens, named via film-labels.json
  "stock": "fuji400",
  "lab": "fotoshoppe",
  "description": "…",               // optional
  "photos": [
    {
      "filename": "000012.jpg",     // must match the uploaded scan
      "width": 3089,                // auto-filled; used for the print's shape
      "height": 2048,
      "priority": 5,                // 1–5, see above
      "caption": "…"                // optional; otherwise "Downtown Durham — No. 12"
    }
  ]
}
```

Frame numbers follow the order of `photos` (the uploader sorts by filename).

## Demo rolls (dev only)

`demo/` holds sample rolls that borrow frames from the digital shoots so the desk can be
tried before any scans are uploaded. They're marked `"demo": true`, which keeps them out of
production builds, and the Digital ⇄ Film switch only appears once a real roll exists.
**Delete the `demo/` folder** (and any demo-only names in `film-labels.json`) once your own
rolls are in.
