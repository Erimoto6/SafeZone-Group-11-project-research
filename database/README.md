# SafeZone database (MySQL)

This folder builds the MySQL database that stores accounts, rooms, limits, the SMS list, alerts and logs.
Shared simulated readings are stored here; physical sensor integration is not included.

| Table | What it holds |
|---|---|
| `users` | every account (admins and students/faculty), passwords as bcrypt hashes |
| `password_resets` | forgot-password codes (hashed), expiry and tries |
| `rooms` | 43 classrooms across four floors on the 1st floor, plus any rooms an admin adds (201..., 301..., 401...) |
| `thresholds` | warning and limit for temperature, humidity, CO2 |
| `settings` | when the fan starts (yellow or red) |
| `sms_recipients` | name, role and mobile number of everyone who gets a text |
| `alerts` | the Alerts list in the app |
| `notification_log` | every SMS and email sent, and whether it worked |
| `system_logs` | faults (sensor, fan, Wi-Fi, ...) |
| `device_status` | the Devices screen (NodeMCU V3 ESP8266, sensors, fan, Wi-Fi, SMS module, power meter) |
| `reading_hourly` | optional hourly summaries for charts and reports (for later) |
| `simulation_state` | shared demo readings, scenario and fan state for each room |
| `electricity_usage` | accumulated estimated exhaust fan energy (legacy lighting totals retained) |
| `room_devices` | configured device groups, quantities, ratings and fan types |

## Run the setup files, in order

1. `01-create-database.sql` creates the database `safezone` and a limited user `safezone_app`.
   **Before running it, change `CHANGE_THIS_PASSWORD` to your own password.** Type the real password only inside
   phpMyAdmin or Workbench. Do not save it in the file you push to GitHub.
2. `02-schema.sql` creates the tables.
3. `03-seed.sql` adds the starting data: limits, 43 classrooms across four floors, and device rows.
4. `04-shared-simulations.sql` adds the shared demo table.
5. `05-electricity-usage.sql` adds persistent estimated energy totals.
6. `06-room-devices.sql` adds device groups and converts existing light/fan ratings.

For an existing database with shared simulations installed, back up the database and run **only 05, then 06** as the database administrator. Keep existing accounts, configuration and `.env`; do not rerun the setup/seed files.
The first admin account is NOT created here. You create it from the backend with `npm run create-admin`.

### Option A: XAMPP (easiest)

1. Install XAMPP from apachefriends.org.
2. Open the XAMPP Control Panel and click **Start** next to **MySQL** and **Apache**.
3. Click **Admin** next to MySQL (or open http://localhost/phpmyadmin).
4. Click the **SQL** tab, paste the whole content of `01-create-database.sql` (with your password), click **Go**.
5. Do the same with `02-schema.sql`, then `03-seed.sql`, then `04-shared-simulations.sql`, `05-electricity-usage.sql` and `06-room-devices.sql`.
6. Check: on the left you should see `safezone` with 14 tables, and `classroom roster has 43 rooms.

XAMPP's database is **MariaDB**, a MySQL-compatible database. These files work on both.
If your adviser needs the real "MySQL" product, use Option B.

### Option B: MySQL Server + Workbench

1. Download **MySQL Installer for Windows** from dev.mysql.com. Install **MySQL Server** and **MySQL Workbench**, and set a root password.
2. Open Workbench, connect as root, then **File > Open SQL Script**, pick `01-create-database.sql`, and click the lightning bolt.
3. Repeat with `02-schema.sql`, `03-seed.sql` `04-shared-simulations.sql`, `05-electricity-usage.sql` and `06-room-devices.sql`.

### Command line (any computer)

    mysql -u root -p < 01-create-database.sql
    mysql -u root -p < 02-schema.sql
    mysql -u root -p < 03-seed.sql
    mysql -u root -p < 04-shared-simulations.sql
    mysql -u root -p < 05-electricity-usage.sql
    mysql -u root -p < 06-room-devices.sql

## Common problems

| Message | Fix |
|---|---|
| `Access denied` | wrong password. Use the same password in `01-create-database.sql` and in `backend/.env` |
| `Unknown database 'safezone'` | run `01-create-database.sql` first |
| `Can't connect to MySQL server` | MySQL is not started. In XAMPP click Start next to MySQL |
| `Check constraint ... is violated` | a room number must match its floor: 1st = 101-199, 2nd = 201-299, ... |

Next: go to `backend/README.md`.

## Classroom roster update (existing Railway database)

Run only `07-classroom-roster.sql` if migrations 01–06 are already installed. It adds missing classrooms without resetting existing room IDs, accounts, thresholds, devices or readings. Fresh installations should also run 07 after 06.

The expected roster is 11 classrooms on floor 1, 10 on floor 2, 10 on floor 3 and 12 on floor 4 (43 total). Rooms 108, 205, 210, 307 and 309 are excluded by the API but remain stored with their historical data. Additional admin-created rooms are preserved, so existing databases may have more than 43 active classrooms.

Lighting groups and past lighting kWh remain stored for history, but are hidden from configuration and excluded from new electricity estimates. The displayed total is accumulated fan kWh. Existing controller inventory is migrated from ESP32 to NodeMCU V3 ESP8266; this corrects inventory naming and does not implement physical sensor communication.
