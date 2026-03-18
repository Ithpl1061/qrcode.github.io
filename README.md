# QR File Platform

Static frontend plus a Cloudflare Worker backend for secure file upload, QR-linked download URLs, and pharma label asset generation.

## Architecture

- Frontend: GitHub Pages / Netlify static site
- Backend API: Cloudflare Worker on `https://gtbl.net`
- Storage: Backblaze B2
- Rendering engine: browser-side SVG template with PNG/PDF export
- QR payload source: backend-returned `fileUrl`

## Public URL Contract

The Worker is the only authority for public asset URLs.

- Upload response URLs must be `https://gtbl.net/download?key=...`
- Label asset URLs must be `https://gtbl.net/download?key=...`
- Frontend code must not rebuild download links from `window.location`, `request.url`, or a `workers.dev` hostname

## Backend API

### `POST /upload`

Response:

```json
{
  "success": true,
  "file": {
    "url": "https://gtbl.net/download?key=uploads/...",
    "key": "uploads/...",
    "fileId": "...",
    "name": "...",
    "size": 1234
  }
}
```

### `POST /generate-label`

Response:

```json
{
  "success": true,
  "labelUrl": "https://gtbl.net/download?key=labels/...png",
  "labelSvgUrl": "https://gtbl.net/download?key=labels/...svg",
  "labelPdfUrl": "https://gtbl.net/download?key=labels/...pdf",
  "manifestUrl": "https://gtbl.net/download?key=labels/...json",
  "fileUrl": "https://gtbl.net/download?key=uploads/..."
}
```

### `GET /download`

Private B2 download proxied through the Worker on the custom domain.

## DNS And Cloudflare

1. Add `gtbl.net` to Cloudflare.
2. Update BigRock nameservers to the two nameservers Cloudflare assigns for the zone.
3. Create a proxied DNS record:
   - `Type`: `CNAME`
   - `Name`: `@`
   - `Target`: `qr-file-platform-worker.ithplqrbackend.workers.dev`
   - `Proxy status`: `Proxied`
4. Bind the Worker to `gtbl.net/*`.

If you prefer the cleaner split architecture, bind the Worker to `files.gtbl.net/*` and keep `gtbl.net` for the website.

## Wrangler

Current [`wrangler.toml`](./wrangler.toml) includes:

- Worker entrypoint: `worker/index.js`
- Route: `gtbl.net/*`
- CORS allowlist for `https://gtbl.net`, GitHub Pages, and local development

Set secrets:

```bash
wrangler secret put B2_KEY_ID
wrangler secret put B2_APP_KEY
```

Deploy:

```bash
wrangler deploy
```

## Frontend Contract

- [`js/app.js`](./js/app.js) points API traffic to `https://gtbl.net`
- [`js/labelGeneratorPage.js`](./js/labelGeneratorPage.js) passes backend-returned `fileUrl` through the payload
- [`js/labelTemplate.js`](./js/labelTemplate.js) generates the QR from `payload.fileUrl`

## Production Checklist

- Upload returns `https://gtbl.net/download?...`
- Label asset URLs return `https://gtbl.net/download?...`
- QR scans resolve to `https://gtbl.net/download?...`
- `workers.dev` remains temporarily reachable only for migration rollback
- No frontend code reconstructs public file URLs client-side
