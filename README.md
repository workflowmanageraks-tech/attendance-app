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
