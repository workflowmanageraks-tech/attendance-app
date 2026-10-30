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

## Version tab (build an Android APK)

Main admin only. **Version** (above Settings) lists the files of your repository; tick the ones that make up the website (index.html must be ticked), set the app name / package id / version and tap **Build APK**.
GitHub Actions (`.github/workflows/build-apk.yml`) wraps the files with Capacitor, builds the APK (about 5–8 minutes) and stores it as a GitHub Release (`apk-<number>`). The tab shows progress and a **Download APK** button.

One-time setup:
1. Upload `.github/workflows/build-apk.yml` to the repository (default branch).
2. The GITHUB_TOKEN on Render needs, besides Contents: Read and write, also **Actions: Read and write**.
3. Repo → Settings → Actions → General → Workflow permissions → **Read and write permissions**.

On the phone: open the downloaded .apk and allow "Install unknown apps". The APK is debug-signed, so uninstall the old one before installing a build from another run.


## VCS Processing - network monitor (main admin only)

Settings > **VCS Processing**. Besides the live request feed it now has five tabs:

- **📜 Requests** - every request with the user, the **client IP and device** (e.g. `App · Android`), size in / out, and every outgoing call it caused (with the server host, data sent / received and timing). **⬇ CSV** exports the list; **📋 Copy report** copies it as text.
- **🌍 Servers** - every server the Render app talks to (`sheets.googleapis.com`, `www.googleapis.com`, `api.github.com`, `smtp.gmail.com:465` ...): calls, failures, average / slowest time, data up / down, **which users** the calls were made for, and the last error.
- **👤 Users** - per user: online now, requests, errors, average time, outgoing calls, data, last IP + device, **which servers their requests reached** and what they do most.
- **📍 Clients** - every IP address that contacted the server, its device, the users seen from it, and a 🚨 flag after 3+ failed sign-ins in 5 minutes.
- **🚨 Alerts** - a server failing 3 times in 2 minutes, a call slower than 5 s, a user sending 100+ requests a minute, 5+ failed sign-ins from one IP, event-loop lag over 800 ms, memory over 420 MB. The same alerts also appear in the Requests feed.

A small chart shows requests per minute for the last 20 minutes (failures in red). Everything is kept in server memory only (nothing is written to the sheet) and resets when Render restarts. Passwords, tokens, query strings and message text are never shown; IPs are visible only to the main admin. Files changed: `live-monitor.js`, `server.js`, `app.js`, `style.css`.

## LIC policy groups

LIC tab > **👥 Policy groups**. Put each policy / premium into a group (family, agent, branch, plan ...).

- **＋ New group** creates a group. If policies are ticked in the table, you can add them to the new group right away.
- Tap a group chip to see only its policies; the cards at the top (total, to-pay-in-1-year, renewals due ...) then show that group's numbers. **No group** shows policies that are not grouped.
- **✏️ Rename** and **🗑 Delete group** appear while a group is open. Deleting a group never deletes policies - they just become *No group*.
- Add policies to a group: tick them in the table > **Move to group** (or choose *No group (remove)*), or pick the **Group** in a policy's Add / Edit form (it also has a **＋ New group** button).
- Group name is shown in the table, in **Copy**, and as a **Group** column in the Excel / PDF export.
- Stored in column **O (Group ID)** of the *LIC Policies* sheet (added automatically); the list of groups is saved in the *Rack Config* sheet (type `LicGroups`). Needs *LIC: Edit* permission to change groups; *View* users can still filter by group. Files changed: `Code.gs` (also `Code_gs.txt`), `app.js`, `style.css`.
