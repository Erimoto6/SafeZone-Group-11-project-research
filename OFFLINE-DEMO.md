# Offline APK demo

This temporary version is on **offline-demo**. The shared-backend version remains on **Test-ni-eleyn** at `ad2a54d`. Building or using this APK does not change your MySQL database or `.env`.

## Build on your Windows computer

1. Keep a backup of your project, `backend/.env`, Android signing files and existing Android folder. If Git reports local changes while switching branches, stop and preserve them rather than discarding them.
2. From the project root:

   ```powershell
   git fetch origin
   git switch offline-demo
   ```

3. Check `www/js/config.js`: `SAFEZONE_MODE` should be `offline`. No IP address is required.
4. In your existing `capacitor.config.json`, keep `appId`, `appName` and `webDir: "www"`. If you previously added `server.url` to load your laptop's site, remove that URL so Android loads its bundled files. This version does not need HTTP cleartext access. Do not replace the whole configuration or delete signing settings.
5. Run from the folder containing your Capacitor configuration:

   ```powershell
   npm ci
   npx cap sync android
   npx cap open android
   ```

   Use your existing Android project. If its folder was saved in a Git stash, restore that folder carefully first; do not apply the entire old stash over the updated frontend. If there has never been an Android project here, `npx cap add android` creates one, but does not recover a deleted signing key or custom native changes.
6. In Android Studio, build the APK. Keep the app ID and signing key when updating an existing installation. The cloud workspace has not built or signed an APK.

## Use with no network or laptop

Open the installed app, choose Admin, then Create an admin account. First-time setup needs your own name, username, email address (any valid address for offline admins), mobile number and password. No admin access code is needed. Later admins are created in Manage Users. Student/faculty registration retains the PUP email format. Accounts from MySQL are separate and must be created again locally.

Log in and start simulations in Settings. Temperature, humidity, CO₂, alerts, automatic/manual exhaust fans, rooms, devices and estimated kWh operate locally. Turn on airplane mode and repeat login and simulation to verify the installed APK itself.

Each phone has its own data. Simulations affect only that installation. No real SMS, email, sensor control, cloud syncing or background/closed-app simulation is included. Email password recovery is unavailable offline; changing a password while logged in requires the current password. Store your demo credentials safely.

Local accounts use salted PBKDF2 password hashes. This is a device demo, not server-enforced multi-user security: someone with control of app storage can change local data. The app keeps at most 200 local alerts. Clearing app data or uninstalling deletes local accounts, rooms, alerts and totals. Installing an update with the same application ID and signing key normally retains app data.

## Return to the shared-backend code after building

Once your APK is saved, from the project root run:

```powershell
git switch Test-ni-eleyn
```

This restores the online source. The APK already built remains the offline version. Before building another APK from the online branch, run `npx cap sync android` again and configure its real API address. Keep any local native configuration/signing changes safe when switching. Offline data is separate and is not imported into MySQL automatically.

## Validation

From `backend`, `npm run test:offline` serves only static assets, disables the browser network, and tests local accounts, passwords, rooms, simulations, alerts, persistence, role checks and data isolation. It requires the development Playwright dependency and Chromium, but no MySQL or running backend. Set `CHROMIUM_PATH` to an existing Chromium executable if needed.
