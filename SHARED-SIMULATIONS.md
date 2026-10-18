# Shared room simulations

All devices must connect to the **same Node.js backend and MySQL database**. A student's registration is stored on that server. When an admin starts a simulation, everyone connected sees the affected rooms' readings and alerts, including students/faculty.

## Update your existing Windows project

1. Stop the backend with Ctrl+C and back up the project and database.
2. Download the latest `Test-ni-eleyn` branch. Copy its `backend`, `www` and `database` folders into your project. **Keep your existing `backend/.env` and MySQL database.** No private settings are included in this update.
3. Start MySQL in XAMPP. In phpMyAdmin's SQL tab, run the entire contents of `database/04-shared-simulations.sql`. It only creates the shared-demo table if it is missing. Do not recreate the database or rerun the earlier setup scripts.
4. In the VS Code terminal inside `backend`, run `npm ci`, `npm run check-db`, then `npm start`.
5. Open `http://localhost:3000/`, press Ctrl+F5 and sign in as an admin.
6. In Settings → Shared demo tools, choose Current room, Choose rooms, or All rooms. For Choose rooms, tick the rooms first. Start a simulation, then watch Monitoring or Alerts. Reset readings uses the same room selection.
7. Open a separate browser or private window, register/sign in as a student/faculty member, and view the same room. Updates arrive automatically about every two seconds while the app is open. No page refresh is needed. Student/faculty accounts cannot start simulations.

Changing a scenario keeps the room's existing readings and ventilation mode. Use Reset readings for a fresh baseline. If the fan is configured to start at Warning, its cooling may prevent Danger. Demo alerts remain stored after reset, page reload or server restart; reset changes readings, not alert history. All simulations are labelled Demo and never send SMS or control an actual fan. Charts/history and device status still contain synthetic data.

## Test on phones on the same Wi-Fi

Run `ipconfig` on the Windows computer and find its Wi-Fi IPv4 address. With the computer, Node.js backend and MySQL running, a phone on that Wi-Fi can open `http://YOUR-COMPUTER-IP:3000/` in its browser. Allow the Node.js port through Windows Firewall on the private network if needed. Local Wi-Fi access is for testing and is not Internet hosting.

## APKs that work away from your computer

1. Host this Node.js backend as a continuously running service with an HTTPS address, connected to a persistent MySQL/MariaDB database. Import the schema there, including the new shared-demo table. The backend's database account needs data access; run schema setup separately as an administrator.
2. Configure database credentials, `JWT_SECRET`, `ADMIN_ACCESS_CODE`, allowed `CORS_ORIGINS` and SMTP settings privately on the server. Keep the Android origin `https://localhost` allowed. `PORT` can be supplied by the hosting provider; set `TRUST_PROXY=1` only when its documented proxy setup requires it. The Node.js service must stay running for simulation progression. MySQL holds shared state; stopping the backend pauses progression without clearing it.
3. In `www/js/config.js`, set `window.SAFEZONE_API_BASE = 'https://YOUR-BACKEND-HOST/api';`. This is a public API address, **not a database address or credential**. Web deployments can retain `/api` when the backend serves the site itself.
4. Sync the updated `www` assets into the actual Capacitor Android project, rebuild the APK and install the updated build on each phone. The Android project in the uploaded local files was under `backend/android`; confirm its real Capacitor configuration before syncing. Native source has not been changed or built by this update.
5. Test two phones against the same HTTPS backend: student registration/login on one, admin simulation on another, then compare the affected room readings and alerts.

This update prepares shared behavior; it does not deploy an online backend or produce an APK. Updates are fetched while the app is open. Background/closed-app push notifications, real SMS, Firebase and ESP32 integration are separate work.

## Developer validation

Use a disposable database and set `SAFEZONE_TEST_DB=1`. From `backend`, run `npm test`, `npm run test:browser` and `npm run test:shared`. Install the Playwright browser with `npx playwright install chromium` first, or set `CHROMIUM_PATH` to an existing Chromium executable. Run suites sequentially because they temporarily modify database settings and clean up afterwards.
