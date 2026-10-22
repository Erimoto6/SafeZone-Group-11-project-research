# Research revisions

Approved revisions for the SafeZone frontend and backend.

## Implemented

- Electricity displays accumulated **estimated kWh**, separately for lights and exhaust fans. Device groups define their own quantities and wattages; lights also record how many are on, and exhaust fans record their type. The backend uses the sum of active light ratings and running exhaust fan ratings. Unconfigured appliances are excluded. This is an estimate, not a meter reading or electricity bill.
- Totals persist in `electricity_usage`. Resetting simulated readings does not erase energy totals, and backend downtime is excluded. Formula: `watts × operating milliseconds ÷ 3,600,000,000`.
- Add Room is available from Home only and contains the creation form. Settings lists current rooms with edit/remove controls; the room selector also offers Edit. Room editing includes floor, room number, and device groups, including different light wattages, exhaust fan types/quantities, and optional controller/sensor/network modules. Devices pages show that configured inventory.
- Monitoring focuses on the chosen metric's live chart, exhaust fan control, and electricity rather than duplicating Home's four sensor tiles. Room selectors remain on Monitoring, Devices and Settings. Extra Add Room controls were removed from those screens and the room picker.
- Room deletion opens a named confirmation popup; Cancel keeps the room. The server preserves at least one room, including concurrent deletion attempts. Deletion cascades the room's inventory and energy totals; alert records remain with no room link.
- Manage Users is a full page with spreadsheet-style Admins, Faculty and Students tables. Tables scroll horizontally on a phone. This is not an Excel download. Admin creation remains on that page, with server-side authorization unchanged.
- Unsaved form values survive navigation within the current session. This includes room/device editing, settings and password forms. Password drafts stay only in browser memory, are never written to storage, and clear on logout; the existing login token continues to support reloads. Drafts clear after successful submission. Drafts are not promised after closing/reloading the app.
- Removed the two repeated banners shown in the screenshot. Electricity is labelled as estimated; Demo labels remain on simulated alerts.
- Exhaust fan wording and alert filter names are consistent across admin and student/faculty views.
- Connection failures distinguish a disconnected device from an unreachable backend. Failed polling marks displayed readings as potentially outdated; a local server can still work over Wi-Fi without public Internet access.

## Applying the update

These changes require both `backend` and `www`, plus migrations `database/05-electricity-usage.sql` and `database/06-room-devices.sql`, in that order. Keep the existing `.env` and database. Back up your database first. Run only these new SQL files as the database administrator, restart the backend and refresh the browser. Installed Android builds need synced web assets and a rebuild. The migrations were applied only in a disposable cloud test database, not your Windows or Railway database.

Migration 06 converts existing light/fan ratings into editable device groups without replacing accounts, readings or alerts. Existing fans start with type Not specified; an admin can choose the real type. It preserves the previous simulated light-on count during conversion. Energy accumulated before this revision is retained. Sensor/controller inventory is configuration only; no new hardware or SMS integration has been added.

## Validation

Use a disposable database with migrations 02–06 installed. Run the suites sequentially, setting `SAFEZONE_TEST_DB=1`: `npm run test:browser`, `npm run test:shared`, and `npm run test:electricity` from `backend`. Set `CHROMIUM_PATH` if using an existing Chromium executable.

Validation passed against a disposable database: 96 API checks, the browser suite, shared simulation checks, and electricity calculations/persistence checks.
