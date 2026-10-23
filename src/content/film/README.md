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

Already named, ready for your next folders (use the token in the folder name):

| Token | Shows as |
| --- | --- |
| `ricohxrm` | Ricoh XR-M |
| `ilfocolor400` | Ilford Ilfocolor 400 Plus |
| `delta400` | Ilford Delta 400 Collector's Edition |
| `hp5` | Ilford HP5 Plus 400 |
| `proimage100` | Kodak ProImage 100 |
| `ektacolorpro400` | Kodak Ektacolor Pro 400 |
| `kodacolor200` | Kodak Kodacolor 200 |
| `fujisuperia` | Fujicolor Superia |
| `samesamebutdifferent400` | Same Same But Different! 400 (Mr. Negative) |
| `secretsauce100` | Secret Sauce 100 (Mr. Negative) |
| `candido800` | Candido 800 |
| `lomocolor92` | Color '92 (Lomography) |
| `lomocolor92sunkissed` | Color '92 Sun-kissed (Lomography) |

e.g. `20261101_ricohxrm_hp5_fotoshoppe_eno-river`.

A brand normally comes from the first word of the name (with Fujicolor counted as
Fujifilm, Lomo as Lomography). For stocks shown without their brand, the `brands`
section of `film-labels.json` names it — that's what groups them under the right
brand button and gives them the right canister color. A different spelling works too; it
just gets a guessed name added to the file for you to fix.

Along the bottom of the page each roll is a film canister labeled with its **film stock**
(the display name above, fitted onto up to three lines), with the roll's **title** and
date under the strip of film. Pick a filter or a roll and the frames file into strips of
negatives: each roll spools out of its canister and ends on a leader with the title
written on a lab sticker. Canister colors follow the stock's display name (Kodak
yellow, Fuji green, Lucky red, Ilford white, CineStill black; anything else gets a steady
color of its own).

## The Negative view

The **Negative** toggle shows every strip as the negatives the scans came from, worked
back from each positive ([`src/components/film/negative.ts`](../../components/film/negative.ts)):

- **The film stock** sets the base and the curves. Kodak's consumer films get a deep
  amber mask, Portra a paler peach one with gentler contrast, Fuji a pinker one, Lucky a
  dense brown one with heavy fog, cine film (CineStill, Candido) the deepest orange.
  Black-and-white stocks (HP5, Delta, FP4, Pan F, Tri-X, T-Max…) are recognized from
  their display names and show as gray silver negatives. The Kodak-made Fujifilm 200 and
  400 count as Kodak. A stock the file doesn't know falls back by brand, then to a
  generic C-41 look.
- **Each scan's `tone`** sets how dense its frame is. Bright scans come from denser
  negatives. Flat ones (muddy blacks and dull whites: a thin negative the scanner had to
  stretch) come from thin negatives that are mostly bare orange base.

`npm run upload-film` measures each scan's tone once it's uploaded. Rolls uploaded before
that can be measured in place (it only adds `tone`):

```bash
npm run measure-film-tone -- --dry-run   # see what would be measured
npm run measure-film-tone                # scans without a tone
npm run measure-film-tone -- --all       # re-measure everything
```

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
      "caption": "…",               // optional; otherwise "Downtown Durham — Frame 12"
      "tone": [0.06, 0.38, 0.95]    // auto-filled: black point, average, white point
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
