# ATTENDANCE-API

Attendance, expenses, work log, time table and chat. Google Sheets is the database, a Node server (Render) is the API.

## Google Calendar sync (Time Table -> each user's own calendar)

1. Google Cloud Console > APIs & Services > enable **Google Calendar API**.
2. OAuth consent screen: add scopes `calendar.events` and `userinfo.email`. Set publishing status to **In production**
   (in "Testing" mode Google expires refresh tokens after 7 days and only allows listed test users).
3. Credentials > Create **OAuth client ID** > *Web application*. Authorized redirect URI:
   `https://YOUR-RENDER-URL/oauth/google/callback`
4. On Render add environment variables:
   - `CAL_CLIENT_ID`, `CAL_CLIENT_SECRET` (from step 3)
   - `PUBLIC_URL`, e.g. `https://attendance-api-yjtj.onrender.com` (no trailing slash)
   - `TOKEN_SECRET`, any long random string (it also encrypts the saved Calendar tokens; keep it stable)
   - optional: `CAL_REMIND_MIN` (reminder minutes before, default 10), `TZ` (default Asia/Kolkata)
5. Each user: Settings > Google Calendar > **Connect Google Calendar**.

Sync is one-way (app -> Calendar). The admin can see who has connected, never anyone's events.

## Voice & video calls (inside Chat)

Open a chat and tap 📞 (voice) or 🎥 (video) at the top. The other person gets a full-screen ringing screen with Accept / Decline.

- Audio and video go directly between the two phones (WebRTC). The server only passes the call "offer/answer" (in memory, no sheet writes).
- Works on Android Chrome and iPhone Safari over **https**. Both people must have the app **open** to ring (there is no background push notification).
- By default it uses free Google STUN servers, which connect most phone-data / Wi-Fi pairs. For strict networks add a **TURN** relay (optional env vars on Render):
  - `METERED_APP` + `METERED_API_KEY` — from a free Metered.ca account (the app name before `.metered.live`), **or**
  - `ICE_SERVERS` — a JSON array, e.g. `[{"urls":["stun:stun.l.google.com:19302"]},{"urls":"turn:HOST:443?transport=tcp","username":"U","credential":"P"}]`

## Fingerprint / Face unlock

Settings > **Fingerprint / Face unlock** > *Enable on this device*. Next time the login screen shows **Unlock with fingerprint / face**. Uses the phone's own biometric (WebAuthn passkey); only a public key is stored on the server. Needs https. Optional env var `ALLOWED_ORIGIN` locks it to your site address.

## Users who can add users

Admin: Settings > Users & access > edit a user > tick **Can add new users**. That user then gets a **Users & access** card in Settings with **＋ Add user**.

- Every user they add automatically joins **their group** (a group is created for them the first time, and their current data becomes the group's data). Group members share the same data.
- The adder sees **only** the users they added (and the person who added them) in Chat, calls and Ludo - not all users. The added users see only the adder (unless the main admin allows more, see below).
- They can only manage (edit / sign out / delete) the users they added, and can never give a new user more access than they have. Only the admin can set location, payment date and the "can add users" right.
- The main admin has no group, so users added by the main admin are not auto-grouped.

## Who can see whom (main admin only)

Nobody sees anybody in Chat, calls, Ludo or group chats unless the **main admin** allows it. Settings > Users & access > edit a user > **Who can this user see in Chat?** - tick the people. It works both ways (if you tick Bob for Niki, Bob also sees Niki). The only automatic links are *the person who added you* and *the people you added*. Stored in column O of the **Users** sheet. Users made by the main admin no longer see each other by default - tick them once.

## Group chat + Ludo for a whole group

Chat > **＋ New group** > name + at least 2 people (you can only pick users you are allowed to see). Only the creator edits / deletes the group (ℹ️ in the group header); members can leave. Groups are stored in the **Group Conversations** sheet (created automatically), messages in the **Chat** sheet.

Tap 🎲 inside a group: the invite goes to **every member**. Whoever accepts joins the lobby (max 4 players, Ludo has 4 colours). The host can press **Start now** once 2 people are in; the game also starts by itself when everybody answered, the lobby is full, or after 90 seconds. 2 players sit in opposite corners; 3-4 players take red / green / yellow / blue. Someone who leaves (or goes offline for 2 minutes) drops out; the last player left wins. One-to-one Ludo works as before.

## Deploy tab (main admin only)

Publish updated files from the app itself: **Deploy** > choose the files (app.js, style.css, index.html, server.js …) > *Review & publish*. They go to GitHub as **one commit** and Render redeploys by itself. The tab also shows the repository's recent commits and per-file history with **Restore this version**.
One-time setup on Render > Environment: `GITHUB_TOKEN` (a fine-grained token with *Contents: Read and write* on only this repository), `GITHUB_REPO` (`owner/name`) and optional `GITHUB_BRANCH` (default `main`). The token never reaches the browser.
Safety: only .js / .css / .html / .md / .json / .gs / .txt / .svg files; no dotfiles or `node_modules`; JS and JSON with a syntax error are refused; server files (`server.js`, `package.json`, `google-store.js`, `gas-shim.js`, `Code.gs`) need an extra confirmation; every publish / restore is written to the Activity log. `Code.gs` runs in Apps Script, so it is still pasted there by hand.

The **Live status** card on the Deploy tab shows the same checks GitHub shows next to a commit (Render's deploy is one of them): *Going live… 1/3 → 2/3 → ✅ Live 3/3* (or ❌ Failed). It refreshes by itself every 5 seconds after a publish. For this, give the token two more **Read-only** repository permissions: **Commit statuses** and **Checks** (GitHub > Settings > Developer settings > Fine-grained tokens > your token > Edit).

## Updates tab (everyone can download, main admin uploads)

Sidebar > **Updates**, right below Deploy. The main admin opens **＋ Upload a new update**, picks a file (any type, up to 40 MB), adds a title / version / note and taps **Upload**. Every signed-in user sees the list and can tap **⬇ Download**. The admin also gets **✏️ Edit** (title, version, note) and **🗑 Delete** on each item. To replace the file itself: delete the item and upload the new one.

- Files are stored in your GitHub repository on a **separate branch** (`app-updates`, created automatically; change it with the optional env var `UPDATES_BRANCH`). Uploading therefore does **not** make Render redeploy. The list itself is kept in the sheet's `_App Properties` tab.
- Needs the same `GITHUB_TOKEN` (Contents: Read and write) and `GITHUB_REPO` as the Deploy tab. Nothing new to set up.
- Downloads go through the server with a 2-minute pass, so the repository can stay private and nobody's login is put in a link.
- Files only reach the app through the website (not from inside Apps Script).

## Offline mode (no network)

- **Entries made with no network are not lost.** Attendance, expenses, work log, links, LIC and time-table changes (add / edit / delete) are kept on the phone and sent automatically, in the same order, the moment the network is back. A small pill at the top shows `📴 Offline · 3 waiting to sync` and then `⏳ Syncing…`.
- The app also **opens with no network** (it shows the last data it loaded). Signing in the first time still needs the network.
- If an entry is rejected by the server when it is finally sent (for example a category was deleted meanwhile), a red message tells you which one.
- Saved passwords (Password Manager) are **never** stored on the phone for offline use and cannot be added offline.
- Every queued entry carries a one-time id, so if the reply gets lost the server never saves it twice.

## Push notifications (app closed)

Calls, payment reminders and the attendance reminder reach the phone even when the app is closed. Each person turns them on once: **Settings > Notifications > Turn on notifications**.

- **Incoming call** - a "📞 Incoming voice call" notification that stays on screen; tap it and the ringing screen opens. It rings for 45 seconds, then it becomes a "📵 Missed call" notification.
- **Attendance** - at 12:00 PM (server time zone `TZ`), if today is not marked, then again every 2 hours until 7 PM, until it is marked.
- **Payment** - the access due date: daily at 10:00 AM from 7 days before until 7 days after. LIC premiums: at 10:00 AM when due in 7, 3 or 1 day, or today.
- Each person can switch the attendance / payment reminders off in the same card.

Setup:
1. `package.json` now lists `web-push`; Render installs it on the next deploy. The notification keys are created by the server by itself and saved in the sheet (`_App Properties`). Optional: set `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (from `npx web-push generate-vapid-keys`) and `VAPID_SUBJECT` (`mailto:you@example.com`).
2. Put **`sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `badge-72.png`** in the same folder as `index.html` on your site. (The Deploy tab can publish `sw.js` and `manifest.json`; the PNG icons are uploaded once on GitHub with *Add file > Upload files*.)
3. **Keep the server awake.** Reminders are sent by a timer inside the server, so it must be running at 12 PM. On Render's free plan the server sleeps after 15 idle minutes - add a free monitor (UptimeRobot / cron-job.org) that opens `https://YOUR-RENDER-URL/` every 5 minutes, or use a paid instance.
4. **Android (Chrome):** works right away, installed or not. **iPhone / iPad (iOS 16.4+):** first Share > *Add to Home Screen*, open the app from that icon, then turn notifications on.
5. Optional env vars: `PUSH_ATT_HOUR` (12), `PUSH_ATT_END_HOUR` (19), `PUSH_ATT_REPEAT_MIN` (120), `PUSH_PAY_HOUR` (10), `PUSH_TICK_SEC` (120).

Notes: a web app cannot make the phone ring like the phone dialer (no full-screen call screen over the lock screen) - the call arrives as a high-priority notification. When somebody signs out, that phone stops receiving their notifications.

## Chat ＋ menu: photos, videos and location

In any chat tap the **＋** next to the message box: **Photo / Video**, **Camera**, **Record video** or **Location**.

- Photos (shrunk to ~1600 px) and videos (max 25 MB, env `MEDIA_MAX_MB`) are saved in the **main admin's Google Drive**, folder **KS Chat Media**. The chat message only holds a small marker; the sheet stores no media.
- Location is sent as a pin; tapping it opens Google Maps. The sender is asked to confirm first.
- Only people in that chat (or group) can view a file; the server streams it from Drive after checking.
- **One-time setup (main admin):** Google Cloud Console > enable **Google Drive API**; OAuth consent screen > add scope `.../auth/drive.file`; then in the app: Settings > **Google Drive** > *Connect Google Drive* and approve. It reuses `CAL_CLIENT_ID`, `CAL_CLIENT_SECRET` and `PUBLIC_URL`; the redirect address is the same as for Calendar. (A service account cannot be used: it has no Drive storage of its own.)
- Photos / videos need the website (Render), not the Apps Script version.
