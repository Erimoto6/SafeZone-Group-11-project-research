# SafeZone

SafeZone is a classroom monitoring app for temperature, humidity, carbon dioxide (CO₂), simulated exhaust fan operation. Admins configure rooms and thresholds, run simulations and manage accounts. Students and faculty view room readings and alerts.

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

1. Follow [database/README.md](database/README.md) and run SQL files **01 through 10 in order** for a new database. Change the database-user password placeholder privately before running file 01. The initial seed creates 43 classrooms across four floors; it does not create an admin account.
2. Open a terminal in `backend` and install dependencies:

   ```powershell
   cd backend
   npm ci
   ```

3. For a separate local backend, set `window.SAFEZONE_API_BASE = '/api';` in `www/js/config.js`; the checked-in frontend currently points to the working Railway backend for the Android app. If you already have `backend/.env`, keep it. For a new installation, copy `.env.example` to `.env` inside `backend`, then configure the database connection, `JWT_SECRET` and `ADMIN_ACCESS_CODE` as described in [backend/README.md](backend/README.md). Keep those values private and out of frontend code and GitHub.
4. From `backend`, check the database and create the first admin:

   ```powershell
   npm run check-db
   npm run create-admin
   npm start
   ```

5. Open **http://localhost:3000/api/health**. A working connection returns `"database":"connected"`. Open **http://localhost:3000/** to use the app, then log in with the admin you created. This version is served by the backend; use its address rather than Live Server.

The `admin / safezone` demo login is not enabled on this branch. Accounts previously stored only in an offline app or browser are not automatically imported into MySQL. Student and faculty registration uses the PUP email formats shown in the app. The login screen does not offer admin registration. An authenticated admin adds appointed admins through Settings → Manage Users; first-time server setup uses `npm run create-admin`.

## Update an existing installation

1. Stop the backend with Ctrl+C. Back up your project and database, including private `.env`, Android configuration and signing files.
2. Update the `Test-ni-eleyn` branch, preserving local work. If Git blocks the update, resolve or save the local changes before proceeding; do not discard them to force a pull.
3. Keep your existing database and accounts. Run only migrations that have not been installed:

   | SQL file | Adds |
   |---|---|
   | `database/04-shared-simulations.sql` | Shared simulation state |
   | `database/05-electricity-usage.sql` | Persistent estimated energy totals |
   | `database/06-room-devices.sql` | Configurable device groups |
   | `database/07-classroom-roster.sql` | Classroom roster |
   | `database/08-recovery-gmail.sql` | Legacy recovery schema, retained for compatibility |
   | `database/09-student-profiles.sql` | Student course and section |
   | `database/10-alert-archives.sql` | Per-account alert archive bookmarks |

   Run missing migrations in numerical order as the database administrator through phpMyAdmin or Workbench. If shared simulations already work and 05/06 are missing, run **05, then 06**. This UI revision adds migration **10**. If 01–09 are already installed, run only `database/10-alert-archives.sql` against the database used by the running backend. Current alerts continue to work before migration 10; Archive becomes available after it is installed. Do not recreate the database or rerun the original setup/seed files for an existing installation.
4. From `backend`, run `npm ci`, `npm run check-db`, then `npm start`. Open http://localhost:3000/ and press Ctrl+F5.
5. For an installed Android app, sync the frontend and rebuild/reinstall the APK as described below. Pulling source code does not update an already installed APK.

Migration 06 converts existing light/fan ratings into editable device groups without replacing accounts, readings or alerts. Existing exhaust fans initially have type **Not specified**; admins can choose their type. It preserves the previous simulated light-on count and existing energy totals.

## Rooms, devices and accounts

- **Home and Monitoring:** select a room to view; admins can also use Add Room. Add Room contains only the creation form. Viewing selectors have no edit/delete controls. Login opens Room 101, or the first configured room if 101 no longer exists, without resetting shared readings.
- **Settings → Room:** use the dropdown to choose the room to configure, then Edit room or Delete room. This choice is separate from the room being viewed. Room information includes floor, room number and device groups.
- **Device groups:** configure quantities, names, exhaust fan wattages/types and optional controller, sensor or network modules. The Devices page displays the room's configured inventory.
- **Delete room:** a named confirmation dialog allows cancellation. Deleting a room removes its inventory and energy totals. Alert history remains without its room link. At least one room must remain, including during concurrent deletion requests.
- **Manage Users:** separate spreadsheet-style Admins, Faculty and Students tables, with horizontal scrolling on phones. Admin creation is on that page. These tables do not provide an Excel download.
- **Account Settings:** changing a password requires the current password and revokes old sessions. Unsaved room/device, settings and password form values survive navigation within the current session. Password drafts stay only in browser memory, clear on logout/success and are not promised after reload or closing the app.

## Shared room simulations

Every participating laptop or phone must use the **same backend and database**. An admin can go to **Settings → Shared demo tools**, choose a numbered room, Select multiple rooms or All rooms, and start high temperature, humidity or CO₂. For multiple rooms, tick the rooms inside the dropdown. Reset readings applies to the same selection. Students/faculty can view simulations but cannot start them.

The backend advances readings approximately every two seconds, even with no clients open. Apps poll for shared readings and alerts while open. Unselected rooms retain their own state. Readings rise gradually toward the saved warning and danger thresholds, roughly 12 seconds per stage from a normal baseline, then return toward baseline after reaching the limit. Automatic ventilation can cool them earlier; a fan triggered at Warning may prevent Danger.

Changing scenarios retains existing readings and ventilation mode. Use Reset readings for a fresh baseline. Shared readings and alerts persist after page reload or backend restart. During a backend outage progression pauses; it resumes without replaying missed ticks. Reset changes readings, not alert history or accumulated energy. Connection failures distinguish a disconnected device from an unreachable backend, and failed polling marks displayed readings as potentially outdated.

To verify sharing, sign in as an admin in one browser and a student/faculty member in another browser or private window. Start a simulation as admin, choose the affected room in the other session and compare readings and alerts.

## Application UI revisions

- **Classroom Overview:** floor filter and a table of room number, temperature, CO₂ and status. Status uses the more severe of temperature and CO₂ against the configured warning/limit. Missing data shows Awaiting data. The table header stays visible inside its scroll area.
- **Temperature Analytics:** rooms ranked by recorded temperature limit-alert count for the last 7 days, last 30 days or all time. Shows the count, days with alerts and latest event; ties use latest event then room number. Archived alerts are included; warnings and other metrics are excluded. Counts use stored event severity, not current thresholds, and include existing demo events. This measures event frequency, not duration, current temperature or a normalized rate. Rooms without limit alerts are omitted. No new migration is needed.
- **Alerts:** selected-room date/time timeline with separate event cards, muted timestamps and neutral borders. Current and Archive each show up to the latest 200 matching records. Archive bookmarks belong to the signed-in account; archiving/restoring does not delete or change original alert records. Run migration 10 to enable it.
- **Accounts and Settings:** account cards replace account tables; Student Accounts opens course buttons, then section buttons, then the profiles for that section. Back returns one level. Accounts without profile details remain under Course not set / Section not set. Password rules appear immediately under the password field and update while typing. Admin input is validated in the browser and again by the API.
- **Graphs:** temperature, humidity and CO₂ charts use samples received during the browser session, retaining at most 40 recent samples per room. Closing/reloading the app clears those chart samples. The time windows filter available samples; earlier readings are not invented. Persistent historical reporting remains future work; `reading_hourly` is reserved for it.

### Electricity feature retained for later

Electricity consumption, meter options and wattage inputs are hidden from the app. Set `FEATURES.fanEnergy` to `true` in `www/js/app.js` to restore the views, then update the asset cache version in `www/index.html` and rebuild the APK if applicable. The backend calculation code, device wattages and `electricity_usage` totals remain intact. They still represent estimated fan energy based on simulated operating time, not measured electricity.

### Notification recommendations (follow-up)

Push notifications and real SMS delivery are not implemented in this revision. The app currently polls while open. Firebase/hardware integration was deferred.

Firebase Cloud Messaging itself has no per-message fee; supporting hosting, network access and implementation can still cost money. Arduino-based SMS requires a compatible cellular module, SIM and carrier messaging/load plan, plus maintenance. Push generally has lower recurring delivery costs when users have internet; SMS can reach users without mobile data but adds carrier costs per message or bundle. Use push as the primary option when internet access is expected, and assess SMS as a fallback using actual carrier quotes and expected alert volume. No paid notification subscription was added.

### Revision verification

Run `node --test backend/test/*.test.js` for backend and alert-grouping checks. `node backend/scripts/ui-revisions-check.cjs` runs mocked responsive browser checks using Playwright and Chromium (set `CHROMIUM_PATH` if needed). `node backend/scripts/password-recovery-check.cjs` checks the direct login-to-code flow, missing identifiers, retries, resend and password reset. These checks do not connect to a production database or send emails.

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

   The current shared endpoint is `https://safezone-group-11-project-research-production.up.railway.app/api`.

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

Temperature, humidity, CO₂, chart history and exhaust fan operation are demos. Devices represent configured inventory, not proof of physical connectivity. Electricity is estimated from configured ratings and simulated operation. Saving SMS recipients does not send SMS. Real NodeMCU V3 ESP8266/Firebase integration, fan commands, SMS delivery and background/closed-app push notifications are separate work. Demo alerts remain labelled as such.

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

### Classroom hardware scope

The default roster includes 43 classrooms across four floors, excluding rooms 108 (clinic), 205 (SCO office), 210 (Registrar and Admission Office), and 307/309 (campus library). For an existing database, run `database/07-classroom-roster.sql` after migrations 01–06. Existing records are preserved. Devices use NodeMCU V3 ESP8266 inventory naming. Lighting configuration is removed; electricity estimates cover exhaust fans only. Physical hardware integration remains future work.

Home only selects rooms for viewing. Admins add missing classrooms from Monitoring and edit existing rooms in Settings. Add/Edit validates room numbers 01–12 on each matching floor and excludes the clinic, offices and library; fully populated floors cannot add another classroom. No database migration is needed for this validation change.

### Password recovery

Enter the admin username or student/faculty mobile number on the login form, then select Forgot Password. This immediately requests a six-digit code for the account’s saved PUP webmail and opens code verification; there is no separate email-entry step. An empty login identifier must be filled first. The API also accepts the previous email-based request for older installed apps. There is no recovery Gmail setup. The project Gmail remains the sender through Vercel. Codes expire in 10 minutes and signed reset grants are single-use; successful password reset revokes old login sessions. Old Gmail-flow codes/tokens stop working after the switch, without a SQL update. See [backend email setup](backend/README.md#pup-webmail-password-recovery).

## Repository layout and Vercel email delivery

| Path | Purpose |
|---|---|
| `www/` | Active HTML, CSS, JavaScript and image assets; Capacitor bundles this directory |
| `android/` | Native Android project, Gradle wrapper and app resources |
| `backend/` | Railway Express API, simulation worker, email client and regression tests |
| `database/` | Schema, seed data and upgrade migrations; keep these for setup/recovery |
| `vercel-email-test/` | **Production** Vercel email relay despite its historical folder name; keep this path because it is the configured Vercel Root Directory |

The temporary `/api/test-email` endpoint and its PowerShell test script have been removed now that email delivery works. Vercel only needs `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `EMAIL_RELAY_SECRET`. Old `EMAIL_TEST_TO` and `EMAIL_TEST_SECRET` variables can be removed from Vercel; they are no longer used. Keep Railway's `EMAIL_RELAY_URL` and matching `EMAIL_RELAY_SECRET`.

For Vercel deployment, use branch `Test-ni-eleyn`, Root Directory `vercel-email-test`, Application Preset **Other**, Node.js **22.x**, and no custom frontend build command. The root page returning 404 is normal for this API-only service. The authenticated `/api/send-code` route performs readiness checks or sends fixed reset/recovery code emails. See [backend relay configuration](backend/README.md#railway-trial-vercel-https-email-relay) for setup and troubleshooting. Never put relay secrets or Google App Passwords in the frontend.

Local checks: `npm ci --prefix backend`, `npm ci --prefix vercel-email-test`, then `node --test backend/test/*.test.js` and `npm test --prefix vercel-email-test`. These use simulated email delivery; installed-APK and real-inbox verification remain separate checks. The database-backed test scripts in `backend/scripts` require an isolated test database.

Dependencies, generated Android assets/build output, `.env` files, `.vercel` configuration and signing material are excluded from Git. Install dependencies locally rather than committing `node_modules`. Flutter development remains on the separate `flutter-version` branch.

All admins can permanently delete a student from **Manage Users → Student Accounts → course → section → trash icon** after explicit confirmation. Active and previously deactivated students are listed with their status. Deletion frees the account email/phone for registration, revokes existing sessions, and deletes the linked SMS contact, recovery Gmail and password reset codes. Notification history remains detached from the account. Faculty/admin accounts cannot be deleted through this action. No additional database migration is needed.

## Room-focused interface and student profiles

- Room selection groups classrooms into expandable floor sections, opening the selected room's floor. Dialog titles/close buttons remain fixed while the content scrolls. Settings uses separate Floor and Room selectors; configuring another room does not change the room being monitored.
- Alerts load the selected room's latest 200 events, organize events newest-first by date, then time, with affected thresholds/fan updates beneath each time entry. Within each displayed minute, a threshold appears once using its most severe recorded event; dividers separate entries. Alerts show timestamped event sentences for the chosen room; live readings remain on Home and Monitoring. Toasts/badges concern new caution/danger events for the selected room, not every background fan update. Original database history is not deleted.
- Monitoring places room selection above the Real-time/History tabs and shows fan and estimated electricity in two aligned cards with a reduced right-hand page gutter. Fan controls remain admin-only.
- Student registration requires a full-name course selection and a free-text section. Existing students can add/change these in Account Settings. Admins open Manage Users → Student Accounts to select a course, then a section, and use the trash icon for permanent deletion after confirmation.

For course/section storage, run **`database/09-student-profiles.sql`** once on the database used by the app, after migration 08. It only creates a linked profile table; existing accounts/passwords remain unchanged and old profiles show as not set until students fill them in. Do not rerun the full setup. Core account access works before migration 09, but saving a profile/new student registration needs the table.

PUP webmail delivery has been confirmed through Outlook. Account Settings no longer includes the temporary test-email button. Password reset codes are sent to the registered PUP address; check Outlook Inbox and Junk.
