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
  (Brevo, SendGrid, Mailgun, or a Gmail account with an "app password"). Then try forgot password with a real
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

### Railway email setup

Set the email variables in the **backend service → Variables**, not in MySQL or the frontend:

```env
NODE_ENV=production
SMTP_HOST=YOUR_PROVIDER_SMTP_HOST
SMTP_PORT=587
SMTP_USER=YOUR_PROVIDER_SMTP_USERNAME
SMTP_PASS=YOUR_PROVIDER_SMTP_PASSWORD
MAIL_FROM=SafeZone <YOUR_VERIFIED_SENDER_EMAIL>
```

Use credentials issued by your email provider. For Gmail, use `smtp.gmail.com`, the sender's full Gmail address as `SMTP_USER`, and a Google app password as `SMTP_PASS` (requires 2-Step Verification). The sender may be a project Gmail address; the recipient must be the PUP address saved on the SafeZone account. Never commit these real values or put them in `www/js/config.js`.

After Railway redeploys, request a reset for an existing account, check its Inbox/Junk folder, enter the six-digit code and choose a new password. Confirm the old password stops working. No SQL migration is required.

The backend checks SMTP connectivity/authentication before accepting reset requests and reports a generic 503 error during an email outage without disclosing whether an account exists. Provider acceptance still does not guarantee inbox delivery; check the sender provider's logs and recipient spam filtering if a code is missing. Some Railway plans restrict outbound SMTP; check current plan support if connections time out, or use a transactional email provider through an HTTPS integration. The Vercel HTTPS relay described below is supported.

## Verified recovery Gmail

Run `database/08-recovery-gmail.sql` after migration 07. It creates `account_recovery` and invalidates outstanding pre-upgrade password reset codes, preserving account/password data. Accounts start without a recovery Gmail.

While logged in, open Account Settings, enter a personal recovery Gmail, request a code, and verify the code. Codes expire in 10 minutes, allow five attempts and have a 30-second resend cooldown. A replacement address stays pending until verified; the previous verified address remains usable. Completing a change invalidates existing password reset codes. Login email remains the PUP address. The forgot-password form accepts the PUP account email and sends only to the verified Gmail saved for that account; it never accepts an arbitrary reset recipient. Accounts without verified recovery Gmail need administrator assistance.

The project sender `safezone.project0@gmail.com` is separate from users' recovery Gmail addresses. In the Railway backend service set:

```env
NODE_ENV=production
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=safezone.project0@gmail.com
SMTP_PASS=YOUR_GOOGLE_APP_PASSWORD
MAIL_FROM=SafeZone <safezone.project0@gmail.com>
```

Enable 2-Step Verification on the sender Google account, then create an App Password. Store the actual value only in Railway/private `.env`. Outbound SMTP must be permitted on the Railway plan; these code changes do not establish mail delivery by themselves. No PUP/Outlook sender credentials are needed.

## Railway Trial: Vercel HTTPS email relay

The Gmail App Password stays in Vercel. Railway calls Vercel over HTTPS; no SMTP connection from Railway is needed. Both recovery Gmail verification and password-reset emails use the same relay.

1. In the existing Vercel email project, keep `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Add `EMAIL_RELAY_SECRET` with a new random value of at least 32 characters. Use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` locally if needed. Keep it private.
2. Deploy the latest `Test-ni-eleyn` commit in Vercel so `/api/send-code` exists.
3. In Railway's **SafeZone backend service → Variables**, add:

```env
EMAIL_RELAY_URL=https://safezone-group-11-project-research.vercel.app/api/send-code
EMAIL_RELAY_SECRET=THE_EXACT_SAME_NEW_SECRET_AS_VERCEL
```

4. Deploy the latest backend with these variables. Old SMTP variables are ignored when relay configuration is present. Never put the relay secret or App Password in the public frontend.
5. While logged in, open Account Settings, enter a recovery Gmail, request/enter the emailed code, then log out and test Forgot Password with the PUP account email. The new reset code arrives at the verified Gmail; after reset the old password should fail.

No new database migration is required if migration 08 is installed. The relay accepts only an authenticated readiness check or a fixed six-digit reset/recovery template sent to one Gmail recipient. Railway remains responsible for authentication, rate limits, recipient ownership, generating/storing codes, verifying attempts/expiry and changing passwords. The public frontend calls Railway, not Vercel.

For failures inspect Railway Deploy Logs for `Recovery email delivery failed:`. `RELAY_AUTH` means the shared secrets do not match (or deployment protection returned 401). `RELAY_RESPONSE` means the endpoint returned HTML/non-JSON, often a wrong deployment URL or deployment protection. `RELAY_CONFIG` means the URL/secret is invalid; use HTTPS and the exact `/api/send-code` path. `RELAY_CONNECTION` means Vercel could not be reached within the timeout. `EAUTH`/`ETIMEDOUT` refer to Gmail delivery from Vercel. Never post secrets or codes in logs/chat.

## Delete students permanently

Every active admin can use Manage Users → Students → Delete and confirm permanent deletion. `DELETE /api/admin/users/:id` accepts active or inactive viewer accounts with `email_kind=student`; faculty/admin accounts cannot be deleted by this endpoint. The linked SMS contact and user row are deleted in one transaction. Existing foreign keys cascade recovery Gmail/password reset records and detach historical notification/threshold references. Account email and phone uniqueness constraints are released for registration again; historical notification recipient addresses may remain in logs. Existing sessions fail because the user no longer exists. Previously deactivated students appear with Inactive status so admins can delete them too. No schema migration or manual SQL is required.
