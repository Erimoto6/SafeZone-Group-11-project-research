# SafeZone Flutter

Flutter frontend for Android, iOS and browser development. It recreates the SafeZone burgundy/pink interface using native Flutter widgets, and uses the existing Node.js/Express API and MySQL database on Railway. The original Capacitor app remains in `www/` and `android/`; the production `Test-ni-eleyn` branch is separate from this `flutter-version` branch.

## Run on Windows

From the repository root:

```powershell
cd flutter_app
& "C:\Users\elain\flutter\bin\flutter.bat" pub get
& "C:\Users\elain\flutter\bin\flutter.bat" analyze
& "C:\Users\elain\flutter\bin\flutter.bat" test
& "C:\Users\elain\flutter\bin\flutter.bat" devices
```

Use an Android phone/emulator listed by `devices`, then run:

```powershell
& "C:\Users\elain\flutter\bin\flutter.bat" run -d YOUR_DEVICE_ID
```

If Flutter is on PATH, use `flutter` instead of the full executable path. Run these commands inside `flutter_app`, not the original Capacitor project root. `flutter run` launches this Flutter app; `npx cap sync` still updates only the original Capacitor app.

The Flutter Android app currently uses a separate application ID, `com.group11.safezone_flutter`, so it can be tested alongside the original `com.group10.safezone` app. Both use the same backend and accounts. No demo `admin / safezone` login is bundled. Use your existing online account; the Flutter login screen offers no public admin registration. Existing admins add appointed admins through Settings → Manage Users.

## API and session configuration

The default API endpoint is:

```text
https://safezone-group-11-project-research-production.up.railway.app/api
```

No database password, JWT signing secret or admin access code belongs in Flutter source. Login tokens are saved using `flutter_secure_storage` (Keychain on iOS and secure platform storage on Android). Passwords stay in form controllers and are cleared when those forms are disposed. Password rules match the current API: at least six characters, a letter and number, no spaces, at most 72 UTF-8 bytes.

Override the API only for a separate development backend:

```powershell
flutter run --dart-define=SAFEZONE_API_BASE=https://YOUR-TEST-BACKEND/api
```

Use HTTPS for hosted builds. An Android emulator's `localhost` is not the Windows host. The existing Railway backend and database remain shared across devices. Simulation controls and other writes in this app affect that shared data; the automated tests use a mocked HTTP client and never contact Railway.

### Browser testing

```powershell
flutter run -d chrome --web-port=7357
```

For authenticated browser requests, the Railway backend must allow `http://localhost:7357` in `CORS_ORIGINS`, in addition to existing origins. Add that specific development origin in Railway and redeploy; never remove the existing Android origins. Native Android/iOS requests do not need a browser development origin. Avoid opening public testing access broadly with `*`.

## Included screens and behavior

- Welcome, admin and student/faculty login, account registration, forgot-password code verification and password reset.
- Home with room selection, sensor status cards, exhaust fan status, estimated kWh and status guide.
- Monitoring with live metric charts, automatic/manual simulated fan control and separate lighting/fan energy totals.
- Alerts with matching All, Danger, Messages and System filters and live polling.
- Configured device inventory for each room.
- Settings with an independent Room configuration dropdown, edit/delete controls, thresholds, fan trigger and single/multiple/all-room simulation controls. Home and Monitoring offer Add Room; viewing selectors do not edit rooms.
- Editable device groups, quantities, active lights, wattages and exhaust fan types. Deletion requires a named confirmation.
- Grouped user tables and admin creation, SMS recipient configuration, email/password changes, light/dark themes and logout.

The app polls shared readings and alerts every two seconds while active. It pauses polling when backgrounded and resumes when foregrounded. Connection errors keep the latest readings visible with a stale-data notice. History displays readings collected during this Flutter session (up to 200 samples per room); the existing API does not expose earlier historical readings. It does not fabricate previous-day charts.

Unsaved room/device drafts stay in memory when the editor is closed and reopened, and clear on successful save or logout. Threshold drafts remain while switching bottom navigation tabs. Drafts are not persisted across app restarts; passwords are never included in room drafts.

Layout and controls follow the original UI, with Material equivalents for native dropdowns, icons and typography. The original logo is bundled. Review spacing and text scaling on actual devices before calling it visually identical to the web app.

Sensor values, exhaust fan behavior and electricity remain simulations/estimates. No physical fan commands, SMS delivery, background push notifications or offline accounts are added by the Flutter rewrite. Reset and room deletion have the same backend behavior as the existing app. Manual fan mode does not automatically enable the fan at a threshold; choose automatic operation for that behavior.

## Build Android

After analysis and tests pass:

```powershell
flutter build apk --debug
```

The debug APK is for testing. Release builds need your own signing configuration; the generated Android scaffold currently uses debug signing as a placeholder. Do not commit signing keys, passwords or local SDK paths. `flutter_app/android` is separate from the root Capacitor `android` folder.

## Build iOS

An iOS scaffold is included in `ios/`. Windows can edit the Dart code and generate the project, but cannot compile or sign an iOS application. Use Xcode on a Mac or a macOS CI/build service. Configure the Apple team, a unique bundle ID, signing and TestFlight/App Store distribution there. The HTTPS Railway API needs no insecure transport exception.

This change does not build an IPA, configure Apple signing or enroll an Apple Developer account. Check dependency/platform requirements with the Flutter version installed on the macOS builder. Do not assume every iPhone supports the deployment target until that target is confirmed in Xcode.

## Verification status

Dart files were parsed for syntax, and Android/iOS configuration and local imports were checked in the cloud workspace. The cloud has no Flutter SDK and its network gateway rejected the official SDK download, so `flutter pub get`, `flutter analyze`, widget/unit tests and platform builds have **not** been run there. Run the commands above on your installed Flutter SDK before installing or sharing a build.

The included tests use mocked HTTP responses to cover request encoding and bearer headers, readable API errors, session restoration/logout, password token rotation, stale-reading behavior, protection against in-flight results after logout, threshold equality and narrow-screen widget layouts. They do not modify your live database.

`pubspec.lock` still reflects the generated starter until `flutter pub get` resolves the newly added packages. Commit the regenerated lockfile after successful resolution, along with any legitimate Flutter-generated source changes; keep build output, `.dart_tool`, local configuration and signing files ignored.
