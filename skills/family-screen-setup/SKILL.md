---
name: family-screen-setup
description: Set up, import curated videos into, verify, or update a family's own Cloudflare-hosted Family Screen instance. Use with the matching Family Screen repository and its CLI, not for general video editing.
---

# Family Screen setup

Use the CLI in this repository for repeatable setup and content changes. The website is a private, parent-curated library. Its source code may be public; each family's video paths, media, credentials, manifests, and Cloudflare resources stay in that family's private environment.

## Before changing anything

- Locate the matching repository release and read its `README.md`. Run `npm run cli -- doctor`; report missing Node, ffmpeg, or Wrangler setup.
- Look for `wrangler.jsonc` and `private/manifest.json` before creating or replacing anything. They are deliberately ignored by Git. Preserve existing resource IDs and any user edits.
- Use the user's stated Cloudflare account, video location, approved titles, and cost limits. If the required account login or local media location is missing, finish all independent local work and ask only for that missing input.
- Do not place passwords, R2 API tokens, real video files, thumbnails, or a private manifest into the public repository or frontend build.

## Build the family's library

1. Run `npm install` and `npm run setup -- --name <family-site-name>` if no private Wrangler config exists. `npm run cf:types` generates binding types.
2. For a normal folder, use `npm run cli -- scan --dir <absolute-path>`. If a verified existing catalog has `id`, `output`, `duration_seconds`, `topics`, and `chapters`, use `npm run cli -- from-catalog --input <absolute-json-path>`.
3. Inspect `private/manifest.json` with the user-provided selection. `scan` and `from-catalog` mark all new items unapproved. Use `npm run cli -- approve --ids <comma-separated-ids>` for chosen entries. Use `--all` only when the user already selected the full list.
4. Run `npm run cli -- estimate` and explain its assumptions. Run `npm run cli -- prepare` to make local thumbnails. For an initial trial, `--limit 3` applies to the approved list.
5. Run `npm run build` and `npm run db:local`; fix build or migration failures before deploying.

## Cloudflare deployment

- Check `npx wrangler whoami`. If the account is not authenticated, use Wrangler's login flow; the account owner may need to complete it. Check the existing free quota and actual resource names before deploying.
- `npm run deploy` uses the repository's Worker Static Assets, D1, and private R2 bindings. Wrangler may provision D1 and write its ID into the ignored `wrangler.jsonc`. Enable R2 in the dashboard and create the configured private bucket before deployment.
- Apply `npm run db:remote` before creating accounts or publishing media.
- Run `npm run cli -- user-add --username <family-login>`. It generates a high-entropy password, writes only a salted digest into D1, shows the password once, and invalidates prior sessions if the account already existed. Let the user store it in a password manager.
- For trial files under 300 MiB, run `npm run cli -- import --limit 3 --wrangler` using Wrangler's existing login. Larger or bulk uploads use R2 S3 credentials supplied by the account owner as environment variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. Keep them out of command text and logs. Complete the approved catalog after playback succeeds.
- Run `npm run cli -- verify --url <site-url> --video-id <published-id>` and test a signed-in desktop browser. Test the actual television's login, remote navigation, H.264/AAC playback, seek, autoplay, and resume before claiming TV support.

## Updating and troubleshooting

- Keep the ignored `wrangler.jsonc` and `private/` data while changing code versions. Apply new D1 migrations before using APIs that depend on them. Back up the D1 data before a schema upgrade.
- Re-run imports for changed approved media. They compare local SHA-256 and remote metadata and reuse matching objects.
- Verify anonymous `/api/catalog` and ranged media requests return HTTP 401. Confirm a signed-in video request returns HTTP 206 and valid `Content-Range`, and that progress survives a new browser session.
- If Cloudflare access, R2 credentials, or free-plan resource limits block a step, report the exact blocker and continue other local work. Do not claim a deployment is complete until the live URL and protected media have been checked.

The repository's Cloudflare configuration targets low ongoing cost for a few family viewers. R2 storage is the main recurring cost once free storage is exceeded. Use the current Cloudflare pricing pages for estimates.
