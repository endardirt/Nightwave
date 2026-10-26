# Nightwave — Static Video Library

A dark, responsive video-feed viewer that runs entirely in the browser. It fetches a JSON API, normalizes common post/attachment formats, displays searchable/sortable cards, and plays HLS (`.m3u8`) or direct video URLs. Watch history and resume positions are stored in the browser's `localStorage`.

## Features

- Static HTML, CSS and JavaScript — no backend, database, build step, or account.
- Paste one or more API URLs (one per line); requests go through the configured Cloudflare Worker to work around browser-side CORS restrictions on public JSON APIs. Raw JSON paste remains available as a fallback.
- Supports JSON arrays and common wrappers such as `posts`, `data`, `items`, `results`, `videos`, and `records`.
- Detects titles, HTML descriptions, publication dates, tags, thumbnail paths, and common attachment/video URL fields.
- Search by title, description, tags, or ID; sort by publication date or title.
- HLS playback via native browser support or `hls.js`; direct MP4/WebM links are also supported.
- Custom playback controls: play/pause, seek, playback speed, hold for 2×, fullscreen, keyboard shortcuts.
- Local watch history (up to 30 items), resume timestamps, progress bars, and clear/remove controls.
- Duplicate prevention across feeds and refreshes using post IDs and normalized titles.
- Responsive mobile layout and loading/error states.

## Files

- `index.html` — page markup
- `styles.css` — responsive dark design
- `app.js` — API parsing, rendering, playback, and local history

## Deploy to GitHub Pages

1. Create a new repository on GitHub, for example `nightwave-video-library`.
2. Upload `index.html`, `styles.css`, `app.js`, and this `README.md` to the **root** of the repository.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/(root)`, then click **Save**.
6. Wait for the Pages deployment to finish. GitHub will show the public site URL in Settings → Pages.
7. Open the published URL, paste your JSON API URL, and choose **Load library**. If the API request fails because of CORS, expand **Or paste the raw JSON directly**, paste the complete JSON response, and choose **Load pasted JSON**.

No GitHub Actions workflow or build step is required.

## API proxy and CORS requirements

API requests are sent through the Cloudflare Worker configured in `app.js`:
`https://nightwave-api-proxy.dirtcoc.workers.dev/?url=...`

The Worker must accept a `url` query parameter, fetch that public endpoint, and return the response with suitable CORS headers. This proxy is intended for public JSON APIs; it does not bypass authentication or other access controls. Video streams and thumbnail hosts may have their own separate CORS restrictions.


### Player quality and navigation shortcuts

- Use the **Quality** menu in the player to choose **Auto** or an available resolution (for example, 720p or 1080p). Your choice is saved in this browser and reused for future videos. Auto is the default until you choose otherwise.
- Press **Shift + P** for the previous video and **Shift + N** for the next video. Navigation follows the currently filtered and sorted library, and switching videos does not exit fullscreen.
- Resolution selection is available for HLS streams played through hls.js. Browsers that use their native HLS player may not expose manual quality selection.
