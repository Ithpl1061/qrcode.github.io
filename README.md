# QR File Platform

Static frontend on `gtbl.net` with a Cloudflare Worker file API on `files.gtbl.net`.

## Architecture

- Website: `https://gtbl.net`
- Worker/API: `https://files.gtbl.net`
- Storage: Backblaze B2
- History store: Cloudflare D1
- QR payload source: backend-returned `fileUrl`

## Public URL Contract

All uploaded files and generated label assets must use:

- `https://files.gtbl.net/download?key=...`

The frontend must never rebuild file URLs from the browser origin or a `workers.dev` hostname.

## Worker Endpoints

- `POST /upload`
- `POST /generate-label`
- `GET /download`
- `GET /labels`
- `GET /labels/:id`

## Cloudflare Setup

1. Add `gtbl.net` to Cloudflare.
2. Update BigRock nameservers to the Cloudflare nameservers assigned to the zone.
3. Keep the website on `gtbl.net`.
4. Remove any existing `files.gtbl.net` DNS record if one already exists.
5. Bind the Worker to `files.gtbl.net` as a Custom Domain.
6. Let Cloudflare create/manage the DNS for the Worker custom domain.

## Wrangler

Current [`wrangler.toml`](./wrangler.toml) is configured for:

- `workers_dev = true` for temporary rollback/testing
- D1 binding `LABELS_DB`
- Worker Custom Domain `files.gtbl.net`
- CORS allowlist for `https://gtbl.net`, `https://www.gtbl.net`, `https://files.gtbl.net`, and local development

## Frontend

- [`js/app.js`](./js/app.js) points API traffic to `https://files.gtbl.net`
- Worker responses return `https://files.gtbl.net/download?...`
- Label QR content comes from backend-returned `fileUrl`
