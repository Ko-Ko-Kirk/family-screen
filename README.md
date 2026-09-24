# Family Screen

A family-owned video library for films that parents choose. The site provides familiar browsing, chapters, ordered next-episode playback, and resume across a family's computers and compatible TV browsers.

The app runs as one Cloudflare Worker with Static Assets, a private R2 bucket, and a D1 database. Each household uses its own Cloudflare account. Code and the setup skill are shareable; each household's manifest and media stay private.

## Requirements

- Node.js 22 or newer, npm, and ffmpeg/ffprobe.
- A Cloudflare account authenticated with Wrangler for deployment. Local development does not need account login.
- For large or bulk media upload: an R2 S3 API token scoped to the household's bucket. The uploader reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` from its environment. Small trial uploads can use Wrangler's existing login.

## First local run

```bash
npm install
npm run setup -- --name my-family-screen
npm run cf:types
npm run db:local
npm run build
npm run dev
```

`wrangler.jsonc` is created from `wrangler.example.jsonc` and ignored by Git. It holds the household's Cloudflare resource identifiers after deployment. The browser opens at Wrangler's printed local address. The login page works once an account is added to the local D1 database:

```bash
npm run cli -- user-add --username family --local
```

This prints a random 32-character password once. Save it in a password manager. D1 stores only the salted SHA-256 digest. The password is generated with 192 bits of random data so verification stays fast enough for a low-cost Worker. Use the generated password instead of choosing a short personal password.

## Choose videos

Scan a regular folder or convert an already verified catalog:

```bash
npm run cli -- scan --dir /absolute/path/to/videos
npm run cli -- from-catalog --input /absolute/path/to/catalog.json
```

The private manifest starts with every new item unapproved. Inspect `private/manifest.json`, then select IDs or explicitly choose the complete list:

```bash
npm run cli -- approve --ids ID1,ID2,ID3
npm run cli -- estimate --limit 3
npm run cli -- prepare --limit 3
```

The importer reads video files from their private source paths. Only approved entries can be published. `scan` accepts H.264/AAC MP4 for browser and TV compatibility; convert other formats before scanning. An existing catalog can be converted by `from-catalog` without putting it into the public repository. Re-importing a catalog preserves approval for unchanged files.

## Deploy and import

```bash
npx wrangler whoami
npm run deploy
npm run db:remote
npm run cli -- user-add --username family
npm run cli -- import --limit 3 --wrangler
npm run cli -- verify --url https://YOUR-WORKER.workers.dev --video-id YOUR-VIDEO-ID
```

Wrangler can provision D1 in the ignored config. Enable R2 in the Cloudflare dashboard and create the private bucket named in `wrangler.jsonc` before deployment. Trial videos under 300 MiB can use `--wrangler` without an extra API token. To upload larger videos, set the four R2 S3 environment variables in your shell or private environment file. The S3 uploader uses multipart upload, verifies object length and SHA-256 metadata, and skips matching objects on reruns. After the trial, run `npm run cli -- prepare` and `npm run cli -- import` for the full approved list.

For an unattended full import, create a local, Git-ignored `private/r2-upload.json` with `accountId`, `bucket`, `accessKeyId`, and `secretAccessKey` string fields, then restrict it to your user (`chmod 600 private/r2-upload.json`). Use an R2 User API token limited to the specific bucket with Object Read/Write access and a short lifetime. Run `npm run upload:all -- --check` to verify the token can read the trial object. Then run `npm run upload:all`; it generates covers, uploads all approved files, and publishes the catalog in D1. The process records its state in `private/upload-status.json`; redirect output to `private/upload.log` when running in the background. On success it removes the temporary key file. If interrupted, run the same command again while the token is valid: matching objects are skipped. Keep the source disk connected and the computer awake until completion.

The public shell has no catalog data. `/api`, `/media`, and `/thumbnails` check a D1 session cookie. An account is created from the CLI; the viewer UI has no signup or upload route. The Worker returns MP4 byte ranges directly from private R2. A 30-minute viewing session does not require video processing on the Worker.

## Cost and limits

For example, a 92 GB library in R2 Standard would cost roughly US$1.23/month when the account has all 10 GB of free monthly storage available. The estimate excludes another project's use of the account, thumbnails, excess operations, taxes, and any paid Worker plan. Run `estimate` against your chosen files and verify the account's actual quota. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Repository structure

- `src/`: React browsing and playback UI.
- `server/`: login, session, catalog, progress, and private media routes.
- `cli/`: setup, scan, approval, thumbnail, estimate, account, and upload commands.
- `migrations/`: versioned D1 schema.
- `skills/family-screen-setup/`: skill that helps agents operate this release.
- `tests/`: meaningful local access and media behavior checks.

The code is under MIT. Actual family media, thumbnails, account details, and viewing history are not part of the software distribution.

## Install the setup skill

After cloning the repository, copy its setup skill into your Codex skills directory:

```bash
mkdir -p ~/.codex/skills
cp -R skills/family-screen-setup ~/.codex/skills/
```

In a new Codex task, ask to use `$family-screen-setup` with this repository. The skill guides local verification, Cloudflare setup, video approval, a three-video trial, and privacy checks. Keep the household's `private/` directory and `wrangler.jsonc` outside Git.
