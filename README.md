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
- The adder sees **only** the users they added (and the person who added them) in Chat, calls and Ludo - not all users. The added users see only the adder.
- They can only manage (edit / sign out / delete) the users they added, and can never give a new user more access than they have. Only the admin can set location, payment date and the "can add users" right.
- The main admin has no group, so users added by the main admin are not auto-grouped.
