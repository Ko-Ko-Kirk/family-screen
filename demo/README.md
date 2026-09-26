# Synthetic local demo

The clips and thumbnails under `demo/public/` are generated from solid colors and simple shapes by `npm run demo:media`. They contain no footage or images from a family's library.

`npm run demo` serves these files with Vite and a mock catalog on `127.0.0.1`. It does not contact Cloudflare or require a login. The demo mode is used only by Vite's local development server; a normal `npm run build` and `npm run deploy` use `public/` instead of `demo/public/`.
