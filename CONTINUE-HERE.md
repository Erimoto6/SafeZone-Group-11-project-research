# Continue SafeZone setup

This update connects the existing frontend to the uploaded Node.js/MySQL backend. MySQL now owns accounts, password resets, rooms, thresholds, ventilation mode, SMS recipients and the alerts list. The backend also serves the frontend, so the web app and API share one address.

## Update your existing Windows project

1. Back up your current project. Copy this update's `backend` and `www` files into the matching folders. **Keep your own `backend/.env`**; no private configuration is included in this update.
2. Start MySQL in XAMPP. Keep your existing `safezone` database and admin account. Do not recreate the database or rerun the original setup/seed files.
3. In phpMyAdmin, open the SQL tab and run `database/05-electricity-usage.sql`, then `database/06-room-devices.sql` as the database administrator. If shared simulations were never installed, run `database/04-shared-simulations.sql` first. These migrations preserve existing accounts and rooms. Then, in a terminal inside `backend`, run `npm ci`, then `npm run check-db`.
4. Run `npm start`. Open `http://localhost:3000` on your Windows computer. This serves both the app and `/api/health`. Use this address instead of Live Server for this version.
5. Log in with the admin account you previously created using `npm run create-admin`. The old frontend-only `admin / safezone` demo account no longer grants access. Accounts previously registered only in browser storage are not automatically migrated; register them on the server.
6. Test student registration and login, admin Settings, Rooms, SMS Alerts, Manage Users, and Account Settings. Saving a password now requires the current password. Old sessions are revoked by the backend when passwords change.

If `check-db` reports no admin account, run `npm run create-admin` once. Keep `DB_PASSWORD`, `JWT_SECRET` and `ADMIN_ACCESS_CODE` private in `.env`. Never put them in frontend configuration.

## Forgot password

The browser now asks the server to create and verify the code. It never creates or verifies a reset code locally. With `SMTP_HOST` empty and `NODE_ENV` not set to `production`, the code appears in the backend terminal for local testing; it is not shown in the app. Real delivery to a PUP inbox still requires SMTP configuration (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) and a delivery test. Do not enable production until email is configured.

## Android and phones

`www/js/config.js` sets `window.SAFEZONE_API_BASE`. The web default `/api` uses the same server as the page. Before syncing an Android app, change it to your hosted **HTTPS** API address, ending in `/api`, then run `npx cap sync` from the folder containing the real Capacitor Android project. Keep `https://localhost` in backend `CORS_ORIGINS` for Android. Do not use `localhost` as the API host on a phone: that means the phone itself. Android packaging was not rebuilt or tested in this cloud update.

## What is still simulated

Temperature, humidity, CO2, charts/history, device status, power and fan operation are still simulated and labelled in the app. Database ventilation mode is saved, but no command reaches a physical fan. Saving SMS recipients does not send SMS. Firebase, ESP32 integration and SMS delivery are the next development phase.

Simulations now run on the Node.js server, with readings stored in MySQL `simulation_state` and messages in `alerts`. In Settings → Shared demo tools, choose **Current room**, **Choose rooms** (tick multiple rooms), or **All rooms**, then select temperature, humidity or CO2. Reset applies to that same selection. All logged-in users connected to this backend receive shared readings and alerts approximately every two seconds while the app is open. Other rooms remain unchanged. An admin controls simulations; students/faculty can only view them.

Readings rise gradually toward the saved warning and danger thresholds (roughly 12 seconds per stage from a normal baseline). Ventilation starting at Warning can prevent Danger. Demo readings and alerts survive browser reloads and backend restarts. The server must be running to advance them; after a server outage progression resumes rather than replaying missed ticks. Reset readings before starting a fresh scenario if a room is already hot or cooling. Simulations never send real SMS or operate hardware.

See [SHARED-SIMULATIONS.md](SHARED-SIMULATIONS.md) for the Windows update and phone/hosting requirements.

## Validation

- `cd backend` then `SAFEZONE_TEST_DB=1 npm test`: supplied API suite, 96 checks. In PowerShell set `$env:SAFEZONE_TEST_DB="1"` first, then run `npm test`.
- Browser integration: use a **disposable development database**, run `npx playwright install chromium`, then `SAFEZONE_TEST_DB=1 node scripts/browser-test.js` (Bash). In PowerShell set `$env:SAFEZONE_TEST_DB="1"` first, then run `node scripts/browser-test.js`. On this cloud machine also set `CHROMIUM_PATH=/usr/bin/chromium`.
- Shared simulation checks: `SAFEZONE_TEST_DB=1 npm run test:shared` from `backend`. These exercise separate admin/student browser contexts, selected/current/all-room controls, server-side progression, authorization and persistence. The table from `04-shared-simulations.sql` must exist first.
- Tests create temporary accounts and change settings, then clean up. Never run these against production or while other people edit the database. No test contacts a real email provider.
- Browser checks cover registration, student/admin login, session reload, persisted settings, room CRUD, SMS recipient CRUD/toggle, admin password changes, password reset and connection errors.

The cloud instance uses its own generated private development configuration and a fresh MariaDB database. It does not contain your Windows database or your existing accounts. Cloud setup does not publish a public API.
