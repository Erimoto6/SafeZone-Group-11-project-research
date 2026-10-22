# SafeZone backend (Node.js + MySQL)

The API behind the app. It handles accounts, login, forgot password (by email), rooms, limits,
the SMS list and alerts, and stores everything in MySQL.
It needs the database from `../database` to be set up first, including migrations `04-shared-simulations.sql`, `05-electricity-usage.sql` and `06-room-devices.sql`, in order. Existing users with shared simulations already installed should back up the database and run only 05 and 06 in phpMyAdmin as the database administrator. Keep the existing `.env`.

## Set it up (Windows)

1. Open a terminal **in this `backend` folder** (in VS Code: right-click the folder > Open in Integrated Terminal).
2. Install the packages:

       npm ci

3. If you already have a working `.env`, keep it. Otherwise make your settings file:

       copy .env.example .env

   Open `.env` and fill in:
   - `DB_PASSWORD` is the password you chose in `01-create-database.sql`.
   - `JWT_SECRET` makes login tokens safe. Generate one and paste it:

         node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

   - `ADMIN_ACCESS_CODE` is the code people type to create an admin account from the app. Change it.
4. Check the database connection:

       npm run check-db

   You should see `All good`. If not, the message tells you what to fix (MySQL not started, wrong password, ...).
5. Create the first admin (it asks for name, username, PUP web mail, mobile number, password):

       npm run create-admin

6. Start the API:

       npm start

   Open http://localhost:3000/api/health in your browser. You should see `"database":"connected"`.
   Then open http://localhost:3000 to use the connected app. Use your database admin account;
   the frontend-only `admin / safezone` demo login is no longer enabled.
7. Optional: run the automatic tests against a **disposable development database**, not your live database.
   Tests temporarily change rooms, thresholds, accounts and recipients. In PowerShell:

       $env:SAFEZONE_TEST_DB="1"
       npm test

   The API suite contains 96 checks. For browser integration checks:

       npx playwright install chromium
       npm run test:browser

   Both test suites disable real email delivery. See [the project guide](../README.md)
   for connecting your Windows app, Android API configuration and remaining simulated features.

Keep `.env` private. It is already in `.gitignore`, so it will not go to GitHub.

## Forgot password and real email

- With `SMTP_HOST` empty in `.env`, the 6-digit code is **printed in this terminal** instead of emailed. Good for testing.
- To send real email, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` from any email service
  (Brevo, SendGrid, Mailgun, Resend... or a Gmail account with an "app password"). Then try forgot password with a real
  PUP address and check the **Junk** folder too, because PUP's mail filter may not trust a new sender.
- Codes work for 10 minutes, allow 5 wrong tries, and need a 30 second wait before a new one. Only a hash of the code is saved.
- Asking for a code gives the same reply whether or not the web mail is registered, so nobody can find out who has an account.

## Shared room simulations

Settings → Shared demo tools lets admins choose the current room, selected rooms or all rooms. The backend worker advances readings every two seconds using the saved thresholds. Apps poll the same server for readings and alerts; phones do not run their own simulator. State and alerts persist in MySQL. See [Shared room simulations](../README.md#shared-room-simulations). Run `SAFEZONE_TEST_DB=1 npm run test:shared` against a disposable database to test independent admin/student clients.

## What the API offers

| Address | Who | What |
|---|---|---|
| `GET /api/simulation` | logged in | shared demo readings and fan state for all rooms |
| `POST /api/simulation` | admin | start/reset a scenario for selected room IDs or all rooms |
| `GET /api/health` | anyone | is the API up and is MySQL connected |
| `POST /api/auth/register` | anyone | student/faculty sign-up (PUP web mail + mobile number + password) |
| `POST /api/auth/register-admin` | needs the access code | admin sign-up |
| `POST /api/auth/login` | anyone | log in with mobile number, web mail or username |
| `GET /api/auth/me` | logged in | who am I |
| `PUT /api/auth/me/email` | logged in | save my web mail |
| `POST /api/auth/change-password` | logged in | change my password |
| `POST /api/auth/forgot` then `verify-code` then `reset` | anyone | forgot password |
| `GET /api/admin/users` / `POST /api/admin/users` | admin | list accounts / add another admin |
| `GET /api/rooms` | logged in | list rooms |
| `POST /api/rooms`, `PATCH /api/rooms/:id`, `DELETE /api/rooms/:id` | admin | add (floor-based numbering), change mode, remove |
| `GET /api/settings` / `PUT /api/settings` | logged in / admin | limits, fan trigger, automatic or manual |
| `GET/POST/PATCH/DELETE /api/sms-recipients` | admin | SMS Alerts list (name, role, number) |
| `GET /api/alerts` | logged in | the Alerts list (`?roomId=`, `?limit=`) |
| `POST /api/alerts` | alert service with `X-API-Key` | add an alert (for the hardware step) |

## Security built in

- Passwords are saved as bcrypt hashes. Login tokens expire, and changing or resetting a password signs out old logins.
- Every database query uses placeholders (no SQL injection). Inputs are checked again on the server.
- Only the two PUP web mail domains are accepted. Rooms must match their floor.
- Slows down guessing (rate limits), hides which accounts exist, and sends safe web headers (helmet).
- The API only answers apps listed in `CORS_ORIGINS`. Add your site there when you host it.
- The database user can read and write data but cannot change the tables.

## Testing from a phone on the same Wi-Fi

Find your computer's address with `ipconfig` (IPv4, like 192.168.1.20). The app would call
`http://192.168.1.20:3000/api`. Windows may ask to allow Node.js through the firewall: allow it on private networks.
A plain `http://` address also needs the Android app to allow it during development.

## Where Firebase fits (next step)

MySQL keeps accounts, rooms, limits, the SMS list and alerts. Firebase will keep the live temperature, humidity
and CO2 readings and the fan commands. A room's `device_id` in the `rooms` table is the link to its Firebase path.
