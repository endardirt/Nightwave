# Nightwave — Static Video Library

A dark, responsive video-feed viewer that runs entirely in the browser. It fetches a JSON API, normalizes common post/attachment formats, displays searchable/sortable cards, and plays HLS (`.m3u8`) or direct video URLs. Watch history and resume positions are stored in the browser's `localStorage`.

## Features

- Static HTML, CSS and JavaScript — no backend, database, build step, or account.
- Paste an API URL; refresh the same feed later. If the API fetch is blocked by CORS, expand **Or paste the raw JSON directly** and paste the complete JSON response instead.
- Supports JSON arrays and common wrappers such as `posts`, `data`, `items`, `results`, `videos`, and `records`.
- Detects titles, HTML descriptions, publication dates, tags, thumbnail paths, and common attachment/video URL fields.
- Search by title, description, tags, or ID; sort by publication date or title.
- HLS playback via native browser support or `hls.js`; direct MP4/WebM links are also supported.
- Custom playback controls: play/pause, seek, playback speed, hold for 2×, fullscreen, keyboard shortcuts.
- Local watch history (up to 30 items), resume timestamps, progress bars, and clear/remove controls.
- Responsive mobile layout and loading/error states, including a clear CORS explanation.

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

## API and CORS requirements

Because GitHub Pages is static, the browser fetches the API directly. The API must allow cross-origin requests from your GitHub Pages origin (or allow `*`) by returning an appropriate `Access-Control-Allow-Origin` response header. If it does not, expand **Or paste the raw JSON directly** and paste the full response copied from wherever you can access it. This bypasses the API-fetch step only; it does not bypass CORS restrictions on video streams or thumbnails. For relative media/thumbnail paths, leave the API URL filled in so the site can use it as the base URL; absolute URLs are more reliable.

The video host must also permit browser playback. HLS.js fetches the playlist and media segments from the stream host, so those responses generally need appropriate CORS headers too. Some streams use short-lived signed URLs and may expire; refresh the API to obtain a new URL.

## JSON shape support

The provided example works with a top-level array and fields such as:

- `title`
- `content` (HTML is converted to plain text for cards)
- `published`
- `file.path` (the example's Pawchive-style thumbnail path is prefixed with `https://img.pawchive.pw/thumbnail/data`)
- `attachments[].temp_url`
- `tags`

Posts without a playable attachment are still shown, but opening them displays a notice instead of launching the player. The parser also recognizes several common alternate fields and wrapper objects; API schemas vary, so unusual field names may require a small adjustment to `normalizePost()` / `findVideoUrl()` in `app.js`.

## Local storage and privacy

Watch history, resume timestamps, and the last API URL are stored in this browser profile using `localStorage`. They are not uploaded by this site. Clearing browser site data removes them. Avoid using shared/public devices if you do not want local history visible to other people using the same browser profile.

## Limitations

- Browsers enforce CORS; a static page cannot work around it.
- DRM-protected streams are not supported.
- Autoplay may be blocked by browser policy; press Play if playback does not start automatically.
- Thumbnail extraction from a playing video is intentionally not attempted; the API-provided thumbnail is used.
- `localStorage` has limited capacity and can be cleared by the browser.


## Updated playback and library behavior

- Click the video to pause or resume; double-click it to toggle fullscreen. Press **K** or **Space** to play/pause, use **←/→** to seek five seconds, and press **F** for fullscreen. Holding Space temporarily plays at 2× speed.
- In fullscreen, move the mouse to reveal the controls and seekbar. The controls stay visible while paused. Drag the seekbar to scrub.
- API and pasted-JSON loads append to the existing library, merging repeated items rather than clearing earlier results. The library is stored in browser `localStorage` and restored after refresh. The saved API URL is fetched again on reload to update the library.
- The Continue Watching section uses the saved thumbnail URL when one is available. Thumbnails are displayed without requiring hover.
- The library and watch history are local to this browser profile and are not synchronized between devices. If browser storage is cleared or full, persistence may fail.
