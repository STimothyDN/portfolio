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
npm run upload-shoot -- <folder> <shoot-slug> "<Title>" <YYYY-MM-DD> ["Location"] [--missing-photo-location "Location"] [--prompt-missing-photo-locations]
```

Example:

```bash
npm run upload-shoot -- /Users/timothynavarro/Pictures/20260630_073639 woodcroft "Walking Around Woodcroft" 2026-06-30 "Durham, NC"
```

This will:

1. Read every image in the folder (`.jpg` / `.jpeg` / `.png` / `.webp`), sorted by filename.
2. Extract each photo's dimensions, EXIF (camera, lens, focal length, aperture,
   shutter speed, ISO, capture date), and GPS coordinates when the file includes them.
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

### Selecting locations for photos without GPS

If a photo has GPS metadata, the upload script writes it automatically:

```jsonc
"location": {
  "latitude": 37.76942,
  "longitude": -122.48621,
  "source": "exif"
}
```

If a batch of photos does **not** have GPS, you can give every missing photo a manual
location during upload:

```bash
npm run upload-shoot -- ~/Desktop/gg-park 2026-06-15-golden-gate-park "Golden Gate Park" 2026-06-15 --missing-photo-location "Golden Gate Park, San Francisco, CA"
```

For mixed-location shoots, ask the uploader to prompt only for photos that do not already
have GPS or a preserved manual location:

```bash
npm run upload-shoot -- ~/Desktop/city-walk 2026-06-15-city-walk "City Walk" 2026-06-15 --prompt-missing-photo-locations
```

You can also hand-edit any individual photo later:

```jsonc
"location": {
  "name": "Stow Lake, Golden Gate Park",
  "latitude": 37.76942,
  "longitude": -122.48621,
  "source": "manual"
}
```

Manual locations are preserved when you re-run the upload with `--force`.

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
      },
      "location": {               // optional; auto-filled from GPS when present
        "name": "Stow Lake, Golden Gate Park", // optional manual label
        "latitude": 37.76942,     // optional, useful for future map/interactive work
        "longitude": -122.48621,
        "source": "manual"        // "exif" or "manual"
      }
    }
  ]
}
```

You can safely hand-edit any field. The only ones the script fills for you are
`filename`, `width`, `height`, `exif`, and GPS-backed `location` — `caption`,
`description`, `coverPhoto`, and manual `location` labels are yours.

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
