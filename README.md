# Family Screen | A private video library for your family

**English** · [繁體中文](README.zh-TW.md)

I wanted to organize the videos my family already has so children could choose what to watch and pick up where they left off, while grandparents could use a TV or computer. That should not require a public video channel or a transcoding server for a handful of viewers.

Family Screen is a self-hosted family video library. Viewers can browse videos, jump to chapters, play the next episode, and resume from their own account's last position. The code can be public while your videos, thumbnails, catalog, and credentials stay in your own Cloudflare account and on your computer.

One Cloudflare Worker serves the website and API. D1 stores accounts, the catalog, and watch progress; a private R2 bucket stores MP4 files and thumbnails. The Worker serves byte ranges from R2, so the app does not need an HLS transcoding server. Test playback on the actual TV or streaming device you plan to use.

The website is for browsing, playback, and resuming. It does not have a video upload or admin interface. To add videos, use the included `$family-screen-setup` skill on the computer holding your files. It guides the local CLI through preparing the catalog and thumbnails, uploading to private R2, and publishing metadata to D1.

## Import videos with the skill

Clone this repository on the computer holding your videos, then install its skill:

```bash
mkdir -p ~/.codex/skills
cp -R skills/family-screen-setup ~/.codex/skills/
```

Open the repository in Codex and invoke `$family-screen-setup`. For example:

> `$family-screen-setup` Add `/absolute/path/to/videos` to my existing Family Screen. Preserve the current catalog and Cloudflare configuration. Show me the new videos, storage estimate, and expected cost; upload the ones I select, then verify authenticated playback and anonymous access protection.

For a new library, you can ask the skill to handle setup and deployment too. The commands below document what it does and can also be run manually. When extending an existing library, preserve `private/manifest.json`: `scan` and `from-catalog` rebuild the local manifest from the input you give them. Scanning only a new folder would leave old entries out of that manifest.

## Run locally

You need Node.js 22 or newer, npm, ffmpeg, and ffprobe. After cloning:

```bash
npm install
npm run setup -- --name my-family-screen
npm run cf:types
npm run db:local
npm run build
npm run cli -- user-add --username family --local --credentials-file private/local-login.txt
npm run dev
```

Use the credentials in `private/local-login.txt` at the local URL printed by Wrangler. Keep that file on your computer with mode `0600`. Git ignores both `private/` and `wrangler.jsonc`. D1 stores a salted password hash rather than a plaintext password. The CLI generates a random password; avoid replacing it with an easy-to-guess shared password.

## Add your videos to the catalog

Scan a folder of MP4 files:

```bash
npm run cli -- scan --dir /absolute/path/to/videos
```

If you already have a prepared JSON catalog, use:

```bash
npm run cli -- from-catalog --input /absolute/path/to/catalog.json
```

Either command creates `private/manifest.json`. New videos are unpublished by default. Review their titles, sources, and order, then approve the entries you want in the family library:

```bash
npm run cli -- approve --ids ID1,ID2,ID3
```

Only use `--all` if you intend to publish every entry in the manifest:

```bash
npm run cli -- approve --all
```

Estimate storage and prepare thumbnails for three trial videos:

```bash
npm run cli -- estimate
npm run cli -- prepare --limit 3
```

`scan` accepts MP4 files with H.264 video and, when audio is present, AAC audio. Other formats need conversion first. These codecs help browsers and TVs play files directly. `prepare` generates thumbnails; `estimate` reports storage and its cost assumptions.

## Deploy to your Cloudflare account

Enable R2 in Cloudflare and create a private bucket matching `bucket_name` in `wrangler.jsonc`. Do not enable an R2 public development URL or custom domain for the bucket. Sign in to your Cloudflare account with Wrangler, then run:

```bash
npx wrangler whoami
npm run deploy
npm run db:remote
npm run cli -- user-add --username family --credentials-file private/remote-login.txt
npm run cli -- import --limit 3 --wrangler
npm run cli -- verify --url https://YOUR-WORKER.workers.dev --video-id YOUR-VIDEO-ID
```

For the first three trial files under 300 MiB each, the import can use your existing Wrangler login. Once signed in, check the catalog, thumbnails, seeking, next-video playback, and resume. In a signed-out window, confirm that catalog and video requests return `401`. The `verify` command checks anonymous access only; TV remote control and playback still need to be tested on the device itself.

The website's static shell is publicly loadable, but the catalog API, thumbnails, and videos require a valid D1 login session. The R2 bucket needs no public URL. Application and storage access controls provide this protection; `noindex` alone does not.

## Import the full library after the trial

Large files and bulk imports use R2's S3 API. In Cloudflare, create a short-lived User API token with **Object Read & Write access limited to this bucket**. Save its details in Git-ignored `private/r2-upload.json`:

```json
{
  "accountId": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "bucket": "my-family-screen-media",
  "accessKeyId": "YOUR_R2_ACCESS_KEY_ID",
  "secretAccessKey": "YOUR_R2_SECRET_ACCESS_KEY"
}
```

On macOS or Linux, run `chmod 600 private/r2-upload.json`. The three trial videos must already be uploaded because the credential check reads the first catalog video:

```bash
npm run upload:all -- --check
nohup npm run upload:all > private/upload.log 2>&1 &
cat private/upload-status.json
tail -f private/upload.log
```

The script completes thumbnails, uploads approved videos, and only then publishes the full catalog to D1. If interrupted, check `private/upload-status.json` for the error. While the token is valid, rerun the same command; objects with matching SHA-256 hashes are skipped. The script deletes its temporary token file after a successful run. If the token expires, create a new restricted token and rerun. Keep the computer awake and the source drive connected during upload.

Alternatively, set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`, then run `npm run cli -- prepare` and `npm run cli -- import` yourself. Never put keys in Git, command-line arguments, or issues.

## Cost and tradeoffs

For a library of about 92 GB, R2 Standard storage would cost roughly US$1.23/month if the account's 10 GB monthly free storage allowance is otherwise unused. Thumbnails, additional operations, other projects' usage, and taxes may add to the bill. Check your account usage and current [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Avoiding real-time transcoding keeps a small family deployment simple and inexpensive. [Workers](https://developers.cloudflare.com/workers/platform/pricing/) and [D1](https://developers.cloudflare.com/d1/platform/pricing/) have their own free allowances and overage rules.

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | Browsing, player, and resume interface |
| `server/` | Login, catalog, progress, and private media routes |
| `cli/`, `scripts/` | Catalog, accounts, thumbnails, and resumable upload tools |
| `migrations/` | D1 schema |
| `skills/family-screen-setup/` | Codex setup, import, and verification skill |
| `tests/` | Local authentication, private playback, and resume tests |

The code is MIT-licensed. Videos and account data supplied by each family are not part of this open-source repository.

## Want an admin interface?

Video imports currently run through the skill and local tools. The website has no create, update, or delete interface for videos. PRs for an admin interface are welcome. Keep R2 private, require authentication for management operations, and never send upload credentials to the browser.
