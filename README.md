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
