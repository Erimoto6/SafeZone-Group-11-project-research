For the connected frontend and next steps, start with [CONTINUE-HERE.md](../CONTINUE-HERE.md).

# SafeZone backend (Node.js + MySQL)

The API behind the app. It handles accounts, login, forgot password (by email), rooms, limits,
the SMS list and alerts, and stores everything in MySQL.
It needs the database from `../database` to be set up first.

## Set it up (Windows)

1. Open a terminal **in this `backend` folder** (in VS Code: right-click the folder > Open in Integrated Terminal).
2. Install the packages:

       npm install

3. Make your settings file:

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
7. Optional: run the automatic test (about 90 checks, cleans up after itself):

       npm test

Keep `.env` private. It is already in `.gitignore`, so it will not go to GitHub.

## Forgot password and real email

- With `SMTP_HOST` empty in `.env`, the 6-digit code is **printed in this terminal** instead of emailed. Good for testing.
- To send real email, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` from any email service
  (Brevo, SendGrid, Mailgun, Resend... or a Gmail account with an "app password"). Then try forgot password with a real
  PUP address and check the **Junk** folder too, because PUP's mail filter may not trust a new sender.
- Codes work for 10 minutes, allow 5 wrong tries, and need a 30 second wait before a new one. Only a hash of the code is saved.
- Asking for a code gives the same reply whether or not the web mail is registered, so nobody can find out who has an account.

## What the API offers

| Address | Who | What |
|---|---|---|
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
