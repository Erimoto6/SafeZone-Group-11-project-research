# SafeZone

SafeZone is a classroom monitoring app for temperature, humidity, carbon dioxide (CO₂), simulated exhaust fan operation and estimated electricity use. Admins configure rooms and thresholds, run simulations and manage accounts. Students and faculty view room readings and alerts.

This branch, **Test-ni-eleyn**, uses a shared Node.js/Express backend and MySQL/MariaDB database. The backend serves the browser app and API from the same address. An Android APK bundles the frontend and connects to that backend. Login, saved data and shared simulations require a running backend and database.

## Project structure

| Location | Purpose |
|---|---|
| `www/` | HTML, CSS, JavaScript and images used by the browser and Capacitor app |
| `backend/` | Express API, authentication, server simulation worker and tests |
| `database/` | SQL setup, seed data and later migrations |
| `capacitor.config.json` | App ID, app name and bundled frontend directory |
| `android/` (local project) | Native Android build files used by Android Studio |

Keep the detailed [backend instructions](backend/README.md) and [database instructions](database/README.md). This README consolidates the former continuation, shared simulation and research revision guides.

## Set up a new installation

You need Node.js/npm, MySQL or MariaDB (for example, XAMPP), and a browser. Android packaging also needs the root project's Capacitor dependencies, Android Studio and an Android project.

1. Follow [database/README.md](database/README.md) and run SQL files **01 through 06 in order** for a new database. Change the database-user password placeholder privately before running file 01. The initial seed creates Rooms 101–110; it does not create an admin account.
2. Open a terminal in `backend` and install dependencies:

   ```powershell
   cd backend
   npm ci
   ```

3. If you already have `backend/.env`, keep it. For a new installation, copy `.env.example` to `.env` inside `backend`, then configure the database connection, `JWT_SECRET` and `ADMIN_ACCESS_CODE` as described in [backend/README.md](backend/README.md). Keep those values private and out of frontend code and GitHub.
4. From `backend`, check the database and create the first admin:

   ```powershell
   npm run check-db
   npm run create-admin
   npm start
   ```

5. Open **http://localhost:3000/api/health**. A working connection returns `"database":"connected"`. Open **http://localhost:3000/** to use the app, then log in with the admin you created. This version is served by the backend; use its address rather than Live Server.

The `admin / safezone` demo login is not enabled on this branch. Accounts previously stored only in an offline app or browser are not automatically imported into MySQL. Student and faculty registration uses the PUP email formats shown in the app. Admin registration from the app requires the private admin access code; an authenticated admin can add further admins through Manage Users.

## Update an existing installation

1. Stop the backend with Ctrl+C. Back up your project and database, including private `.env`, Android configuration and signing files.
2. Update the `Test-ni-eleyn` branch, preserving local work. If Git blocks the update, resolve or save the local changes before proceeding; do not discard them to force a pull.
3. Keep your existing database and accounts. Run only migrations that have not been installed:

   | SQL file | Adds |
   |---|---|
   | `database/04-shared-simulations.sql` | Shared simulation state |
   | `database/05-electricity-usage.sql` | Persistent estimated energy totals |
   | `database/06-room-devices.sql` | Configurable device groups |

   Run missing migrations in numerical order as the database administrator through phpMyAdmin or Workbench. If shared simulations already work and 05/06 are missing, run **05, then 06**. If all migrations are installed, no new SQL is needed. Do not recreate the database or rerun the original setup/seed files for an existing installation.
4. From `backend`, run `npm ci`, `npm run check-db`, then `npm start`. Open http://localhost:3000/ and press Ctrl+F5.
5. For an installed Android app, sync the frontend and rebuild/reinstall the APK as described below. Pulling source code does not update an already installed APK.

Migration 06 converts existing light/fan ratings into editable device groups without replacing accounts, readings or alerts. Existing exhaust fans initially have type **Not specified**; admins can choose their type. It preserves the previous simulated light-on count and existing energy totals.

## Rooms, devices and accounts

- **Home and Monitoring:** select a room to view; admins can also use Add Room. Add Room contains only the creation form. Viewing selectors have no edit/delete controls. Login opens Room 101, or the first configured room if 101 no longer exists, without resetting shared readings.
- **Settings → Room:** use the dropdown to choose the room to configure, then Edit room or Delete room. This choice is separate from the room being viewed. Room information includes floor, room number and device groups.
- **Device groups:** configure quantities, names, different light wattages, the number of lights on, exhaust fan wattages/types and optional controller, sensor or network modules. The Devices page displays the room's configured inventory.
- **Delete room:** a named confirmation dialog allows cancellation. Deleting a room removes its inventory and energy totals. Alert history remains without its room link. At least one room must remain, including during concurrent deletion requests.
- **Manage Users:** separate spreadsheet-style Admins, Faculty and Students tables, with horizontal scrolling on phones. Admin creation is on that page. These tables do not provide an Excel download.
- **Account Settings:** changing a password requires the current password and revokes old sessions. Unsaved room/device, settings and password form values survive navigation within the current session. Password drafts stay only in browser memory, clear on logout/success and are not promised after reload or closing the app.

## Shared room simulations

Every participating laptop or phone must use the **same backend and database**. An admin can go to **Settings → Shared demo tools**, choose a numbered room, Select multiple rooms or All rooms, and start high temperature, humidity or CO₂. For multiple rooms, tick the rooms inside the dropdown. Reset readings applies to the same selection. Students/faculty can view simulations but cannot start them.

The backend advances readings approximately every two seconds, even with no clients open. Apps poll for shared readings and alerts while open. Unselected rooms retain their own state. Readings rise gradually toward the saved warning and danger thresholds, roughly 12 seconds per stage from a normal baseline, then return toward baseline after reaching the limit. Automatic ventilation can cool them earlier; a fan triggered at Warning may prevent Danger.

Changing scenarios retains existing readings and ventilation mode. Use Reset readings for a fresh baseline. Shared readings and alerts persist after page reload or backend restart. During a backend outage progression pauses; it resumes without replaying missed ticks. Reset changes readings, not alert history or accumulated energy. Connection failures distinguish a disconnected device from an unreachable backend, and failed polling marks displayed readings as potentially outdated.

To verify sharing, sign in as an admin in one browser and a student/faculty member in another browser or private window. Start a simulation as admin, choose the affected room in the other session and compare readings and alerts.

## Estimated electricity

Electricity displays accumulated **estimated kWh**, separately for lights and exhaust fans. Device quantities, active light counts, configured wattages and simulated fan operating time determine the estimate:

```text
kWh = watts × operating milliseconds ÷ 3,600,000,000
```

Totals persist in `electricity_usage`; backend downtime is excluded. Resetting simulated readings does not erase totals. Unconfigured appliances are excluded. This is not a measured energy reading, cost estimate or electricity bill.

## Phones on the same Wi-Fi

For local testing, keep the laptop, MySQL and backend running. Find the laptop's active IPv4 address with `ipconfig`, then open this address in the phone's browser:

```text
http://YOUR-COMPUTER-IP:3000/api/health
```

It must show a connected database. The phone can open `http://YOUR-COMPUTER-IP:3000/` to use the browser app. Allow Node.js through Windows Firewall for the appropriate private network. Some school/guest networks block connections between devices. Local Wi-Fi testing does not need public Internet access, but it does need that local connection.

For an Android APK, set the same host in `www/js/config.js`, ending in **`/api`**, not `/api/health`. A local `http://` API also needs `server.cleartext: true` inside the existing Capacitor configuration for development. `localhost` on a phone refers to the phone itself, not your laptop. Keep Android's `https://localhost` origin allowed in backend `CORS_ORIGINS`.

## Android and hosting

For an APK that works away from the laptop:

1. Deploy the Node.js backend as a continuously running service connected to persistent MySQL/MariaDB. Install the SQL schema/migrations separately as an administrator. The backend database user needs data access, not permission to modify the schema.
2. Configure database credentials, `JWT_SECRET`, `ADMIN_ACCESS_CODE`, `CORS_ORIGINS` and any SMTP settings privately on the server. The hosting provider may supply `PORT`. Use `TRUST_PROXY=1` only when its proxy configuration requires it.
3. Give the backend a public HTTPS domain. In `www/js/config.js`, set:

   ```js
   window.SAFEZONE_API_BASE = 'https://YOUR-BACKEND-HOST/api';
   ```

   This is a backend API address, not a MySQL connection URL or password. The browser version can retain `/api` when the backend serves the page.
4. From the project root containing `capacitor.config.json`, install root dependencies if necessary, then sync and open the actual Android project:

   ```powershell
   npm ci
   npx cap sync android
   npx cap open android
   ```

   Keep `webDir` pointing to `www`. An APK should load bundled assets rather than a development `server.url`. A valid Android project needs `android/settings.gradle`, `android/build.gradle` and `android/app/build.gradle`; `cap sync` alone does not recreate missing native build files. Preserve or restore existing Android source and signing files before regenerating a project.
5. Build in Android Studio, install the updated APK and test two devices against the same backend. The laptop can remain off when both backend and database run online. Phones still need Internet access to that backend.

These instructions do not deploy hosting or build/sign an APK automatically. Native packaging has not been validated in the cloud workspace. The temporary [offline-demo branch](https://github.com/Erimoto6/SafeZone-Group-11-project-research/tree/offline-demo) is separate: its data stays on each phone. Switching source branches does not change an APK already built; sync again before rebuilding for a different version. Offline data does not automatically transfer to MySQL.

## Forgot password

Reset codes are generated and verified by the backend. With `SMTP_HOST` empty and `NODE_ENV` not set to `production`, a code appears only in the backend terminal for local testing. It is not shown in the app. Real delivery needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` configured, followed by a delivery test to a PUP inbox, including its Junk folder. Configure email before enabling production.

Codes expire after 10 minutes, allow five incorrect attempts and require 30 seconds before requesting another. The backend stores a hash of the code and returns the same request response whether an email is registered or not.

## What remains simulated

Temperature, humidity, CO₂, chart history and exhaust fan operation are demos. Devices represent configured inventory, not proof of physical connectivity. Electricity is estimated from configured ratings and simulated operation. Saving SMS recipients does not send SMS. Real ESP32/Firebase integration, fan commands, SMS delivery and background/closed-app push notifications are separate work. Demo alerts remain labelled as such.

## Validation

Use a **disposable development database** with migrations through 06 installed. Tests temporarily modify accounts, rooms, thresholds, recipients, alerts and simulation state, then clean up. Do not run them against production or while others edit the same database. Tests do not contact a real email provider.

From `backend`, using PowerShell:

```powershell
$env:DB_NAME="YOUR_DISPOSABLE_TEST_DATABASE"
$env:SAFEZONE_TEST_DB="1"
npx playwright install chromium
npm test
npm run test:browser
npm run test:shared
npm run test:electricity
```

Run suites sequentially. In Bash, use `SAFEZONE_TEST_DB=1` and the test database environment variable before each command. Set `CHROMIUM_PATH` when using an existing Chromium executable; the cloud workspace used `/usr/bin/chromium`.

Validation completed against a disposable MariaDB database: 96 API checks; browser registration/login, role checks, session reload, settings, room/device CRUD, SMS recipient CRUD/toggles, password changes/reset and network errors; independent admin/student shared simulations; and estimated energy conversion, persistence, reset behavior, downtime exclusion and duplicate-tick protection. Layout checks covered main screens and dialogs at 320, 390, 768 and 1280 pixels in light and dark themes. These browser checks do not replace testing an installed APK.

The cloud development database and private configuration are separate from your Windows or hosted database; they do not contain your existing accounts or create a public API.
