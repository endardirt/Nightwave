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

The Worker must accept a `url` query parameter, fetch that public endpoint, and return the response with suitable CORS headers. If the original API URL contains a `limit` query parameter, the frontend removes it from the forwarded API URL and passes it to the Worker separately as `?limit=...`. The Worker must apply that separate limit to the upstream request/response as intended by your Worker implementation. This proxy is intended for public JSON APIs; it does not bypass authentication or other access controls. Video streams and thumbnail hosts may have their own separate CORS restrictions.


### Player quality and navigation shortcuts

- Use the **Quality** menu in the player to choose **Auto** or an available resolution (for example, 720p or 1080p). Your choice is saved in this browser and reused for future videos. Auto is the default until you choose otherwise.
- Press **Shift + P** for the previous video and **Shift + N** for the next video. Navigation follows the currently filtered and sorted library, and switching videos does not exit fullscreen.
- Resolution selection is available for HLS streams played through hls.js. Browsers that use their native HLS player may not expose manual quality selection.

## Supabase accounts and cloud sync

Nightwave now supports username/password accounts and syncs each account's API URL list, saved library, and watch history to Supabase. It uses the supplied project URL and **publishable** key in the browser. Never put the Supabase secret key in `app.js`, HTML, CSS, GitHub Pages, or any other public file.

### 1. Create the database tables and policies

In the Supabase Dashboard, open **SQL Editor → New query**, paste the contents of `supabase/setup.sql`, and run it. The `usernames` table deliberately has no browser-accessible policies; only the Edge Function accesses it. `user_data` has RLS policies limiting each signed-in user to their own row.

### 2. Install the Supabase CLI

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and make sure Git is available. From a terminal, change directory to the `streamflix` folder extracted from this ZIP, then run:

```bash
supabase login
supabase link --project-ref hsahfshjaqldddatsqsx
```

### 3. Set Edge Function secrets

In the Supabase Dashboard, open **Project Settings → API Keys** and copy the project's **secret** key (not the publishable key). Then run these commands from the `streamflix` folder. Replace the placeholder with your actual secret key; do not share it or commit it:

```bash
supabase secrets set NIGHTWAVE_SUPABASE_PUBLISHABLE_KEY=sb_publishable__1SwgYmZa6ylPLNfed902g_tXT450l6 NIGHTWAVE_SUPABASE_SECRET_KEY=PASTE_YOUR_SECRET_KEY_HERE
```

The secret is stored in Supabase's function environment, not in the website source. `SUPABASE_URL` is provided automatically by Supabase to deployed Edge Functions. The function is configured with `verify_jwt = false` because sign-up and sign-in happen before the browser has a user session; it checks the project's publishable key itself. Do not disable authentication checks for other functions.

### 4. Deploy the username authentication function

```bash
supabase functions deploy username-auth
```

The function is located at `supabase/functions/username-auth/index.ts`. It creates an Auth user with an internal, non-deliverable address and keeps the username mapping server-side. Users see and enter only their username and password. The function returns a normal Supabase session; subsequent data requests use the user's session and the database's RLS policies.

### 5. Publish the website

Upload `index.html`, `styles.css`, `app.js`, `README.md`, and the `supabase` directory to your GitHub repository. The SQL file is documentation/setup and the Edge Function must be deployed with the CLI; GitHub Pages will not deploy it automatically. Then hard-refresh the website. Create an account, then test signing out and back in.

### Security and behavior notes

- Only the public publishable key is embedded in `app.js`. The secret key belongs only in Supabase Edge Function secrets.
- Usernames are normalized to lowercase and limited to 3–24 letters, numbers, or underscores. Passwords must be at least 8 characters.
- Each user's cloud record stores API URLs, library posts, and watch history. The browser also retains a local copy as a cache/backup. On a first login with no cloud row, existing local data is imported; when a cloud row exists, it is restored to the browser.
- Temporary video URLs can expire; refreshing the relevant feed updates them as before.
- The function includes basic validation but does not implement a custom distributed rate limiter. For a public deployment, monitor Auth/function abuse and configure suitable rate limiting or abuse protection before sharing it widely.
- Username-only login uses a private username-to-Auth-user mapping. Do not add public RLS policies to the `usernames` table.
