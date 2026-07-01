# Photography Shoots

This folder holds one JSON file per **shoot**. Each file is a content-collection entry
(schema defined in [`src/content/config.ts`](../config.ts)) that powers:

- the listing page at **`/photography/`** (one cover card per shoot), and
- a detail page at **`/photography/<shoot-slug>/`** (masonry gallery + lightbox).

Photos themselves are **not** stored in the repo — they live in a Bunny.net Storage zone
and are served through a Bunny Pull Zone CDN. This folder only holds the metadata
(filenames, captions, camera settings).

---

## Adding a new shoot (the normal workflow)

### 1. One-time setup

Copy [`.env.example`](../../../.env.example) to `.env` in the repo root and fill it in:

```
PUBLIC_BUNNY_CDN_URL=https://<your-pull-zone>.b-cdn.net
BUNNY_STORAGE_ZONE=<your-storage-zone-name>
BUNNY_STORAGE_REGION=              # leave blank for the default (DE) region
BUNNY_STORAGE_ACCESS_KEY=<storage-zone-password>
```

> `BUNNY_STORAGE_ACCESS_KEY` is the **Storage Zone password** (Bunny dashboard →
> your Storage Zone → *FTP & API Access*), **not** your account API key.

`.env` is gitignored. `PUBLIC_BUNNY_CDN_URL` must **also** be set in your host's env
vars (Vercel dashboard) so production builds can generate image URLs.

### 2. Upload the photos and scaffold the file

Put a shoot's photos in a local folder, then run:

```bash
npm run upload-shoot -- <folder> <shoot-slug> "<Title>" <YYYY-MM-DD> ["Location"]
```

Example:

```bash
npm run upload-shoot -- ~/Desktop/gg-park 2026-06-15-golden-gate-park "Golden Gate Park" 2026-06-15 "San Francisco, CA"
```

This will:

1. Read every image in the folder (`.jpg` / `.jpeg` / `.png` / `.webp`), sorted by filename.
2. Extract each photo's dimensions and EXIF (camera, lens, focal length, aperture,
   shutter speed, ISO, capture date).
3. Upload each file to Bunny Storage at `photography/<shoot-slug>/<filename>`.
4. Write `src/content/photography/<shoot-slug>.json` with everything filled in
   **except captions**, which are left blank for you.

> **Slug convention:** use `<date>-<kebab-title>`, e.g. `2026-06-15-golden-gate-park`.
> The slug becomes the URL (`/photography/<slug>/`) **and** the Bunny storage folder,
> so keep them identical.

### 3. Fill in captions and commit

Open the generated `<shoot-slug>.json`, type a `caption` for whichever photos you want
(leave the rest as `""`), then commit and push. The site rebuilds and the shoot goes live.

### Adding more photos to an existing shoot

Re-run the same command against a folder of the new photos, with `--force`:

```bash
npm run upload-shoot -- ~/Desktop/gg-park-more 2026-06-15-golden-gate-park "Golden Gate Park" 2026-06-15 --force
```

`--force` **merges**: new photos are appended, and captions you already wrote are
preserved (never overwritten).

---

## File format

```jsonc
{
  "title": "Golden Gate Park",
  "date": "2026-06-15",            // the day of the shoot (YYYY-MM-DD)
  "location": "San Francisco, CA", // optional
  "description": "Shot on a foggy morning near Stow Lake.", // optional, shown under the title
  "coverPhoto": "IMG_0042.jpg",    // optional; defaults to the first photo
  "photos": [
    {
      "filename": "IMG_0042.jpg",  // must match the file uploaded to Bunny
      "caption": "First light through the cypress.", // shown in the lightbox
      "width": 1600,               // used to reserve layout space (auto-filled)
      "height": 1067,
      "exif": {                    // all auto-filled from the photo; all optional
        "camera": "Fujifilm X-T5",
        "lens": "XF 23mm f/1.4",
        "focalLength": "23mm",
        "aperture": "f/2.8",
        "shutterSpeed": "1/500s",
        "iso": 200,
        "capturedAt": "2026-06-15T07:12:00.000Z"
      }
    }
  ]
}
```

You can safely hand-edit any field. The only ones the script fills for you are
`filename`, `width`, `height`, and `exif` — `caption`, `description`, and `coverPhoto`
are yours.

---

## How the pages behave for visitors

- **Listing (`/photography/`)** — shoots shown newest-first as cover cards with date and
  photo count.
- **Shoot detail (`/photography/<slug>/`)** — a responsive masonry grid (2 columns on
  mobile, 3 on desktop). Clicking any photo opens the lightbox:

  | Action | Control |
  |---|---|
  | Next / previous photo | arrow buttons, `←` / `→` keys, or swipe |
  | Show camera settings (EXIF) | the **(i)** button, or `i` key |
  | Close | the **✕** button, `Esc`, or click the backdrop |

  Captions appear as a subtle gradient overlay along the bottom of each photo.

---

## Testing locally

Run `npm run dev` and visit `/photography/`. A `test-shoot.json` fixture (with local
placeholder images under `public/photography/test-shoot/`) is included so the gallery and
lightbox work without any Bunny.net setup. **Delete `test-shoot.json` and that folder once
you've uploaded a real shoot.**
