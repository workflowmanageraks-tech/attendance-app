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

## Fingerprint / Face unlock

Uses the phone's own fingerprint, face or screen lock (WebAuthn passkeys). Nothing biometric is sent or stored on the server — only a public key per device.

- Needs the app opened over **https** from a normal browser/PWA (not inside an iframe). Works on Android Chrome, iPhone Safari (Face ID / Touch ID), Windows Hello and Mac Touch ID.
- Each user: sign in once with the password > Settings > **Fingerprint / Face unlock** > *Enable on this device*. Next time the login screen offers **Unlock with fingerprint / face**.
- Up to 5 devices per user; remove any of them from the same card. Disabled users, payment-due and "location required" rules still apply.
- Optional env var: `ALLOWED_ORIGIN` = your app's exact address (e.g. `https://yourname.github.io`) to lock biometric unlock to that site.
- Keep the same website address: a key made on one address will not work on another. If you move the site, enable it again.
