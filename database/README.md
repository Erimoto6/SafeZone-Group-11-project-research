# SafeZone database (MySQL)

This folder builds the MySQL database that stores accounts, rooms, limits, the SMS list, alerts and logs.
(Live temperature, humidity and CO2 readings go to Firebase later, not here.)

| Table | What it holds |
|---|---|
| `users` | every account (admins and students/faculty), passwords as bcrypt hashes |
| `password_resets` | forgot-password codes (hashed), expiry and tries |
| `rooms` | Room 101 to 110 on the 1st floor, plus any rooms an admin adds (201..., 301..., 401...) |
| `thresholds` | warning and limit for temperature, humidity, CO2 |
| `settings` | when the fan starts (yellow or red) |
| `sms_recipients` | name, role and mobile number of everyone who gets a text |
| `alerts` | the Alerts list in the app |
| `notification_log` | every SMS and email sent, and whether it worked |
| `system_logs` | faults (sensor, fan, Wi-Fi, ...) |
| `device_status` | the Devices screen (ESP32, sensors, fan, Wi-Fi, SMS module, power meter) |
| `reading_hourly` | optional hourly summaries for charts and reports (for later) |
| `simulation_state` | shared demo readings, scenario and fan state for each room |

## Run the setup files, in order

1. `01-create-database.sql` creates the database `safezone` and a limited user `safezone_app`.
   **Before running it, change `CHANGE_THIS_PASSWORD` to your own password.** Type the real password only inside
   phpMyAdmin or Workbench. Do not save it in the file you push to GitHub.
2. `02-schema.sql` creates the tables.
3. `03-seed.sql` adds the starting data: limits, Room 101 to 110, and device rows.
4. `04-shared-simulations.sql` adds the shared demo table. For an existing working database, run **only this new file** as the database administrator; keep existing accounts and configuration.

For an existing working database, run only the new step 4. Its `CREATE TABLE IF NOT EXISTS` keeps existing data intact.
The first admin account is NOT created here. You create it from the backend with `npm run create-admin`.

### Option A: XAMPP (easiest)

1. Install XAMPP from apachefriends.org.
2. Open the XAMPP Control Panel and click **Start** next to **MySQL** and **Apache**.
3. Click **Admin** next to MySQL (or open http://localhost/phpmyadmin).
4. Click the **SQL** tab, paste the whole content of `01-create-database.sql` (with your password), click **Go**.
5. Do the same with `02-schema.sql`, then `03-seed.sql`, then `04-shared-simulations.sql`.
6. Check: on the left you should see `safezone` with 12 tables, and `rooms` has 10 rows.

XAMPP's database is **MariaDB**, a MySQL-compatible database. These files work on both.
If your adviser needs the real "MySQL" product, use Option B.

### Option B: MySQL Server + Workbench

1. Download **MySQL Installer for Windows** from dev.mysql.com. Install **MySQL Server** and **MySQL Workbench**, and set a root password.
2. Open Workbench, connect as root, then **File > Open SQL Script**, pick `01-create-database.sql`, and click the lightning bolt.
3. Repeat with `02-schema.sql`, `03-seed.sql` and `04-shared-simulations.sql`.

### Command line (any computer)

    mysql -u root -p < 01-create-database.sql
    mysql -u root -p < 02-schema.sql
    mysql -u root -p < 03-seed.sql
    mysql -u root -p < 04-shared-simulations.sql

## Common problems

| Message | Fix |
|---|---|
| `Access denied` | wrong password. Use the same password in `01-create-database.sql` and in `backend/.env` |
| `Unknown database 'safezone'` | run `01-create-database.sql` first |
| `Can't connect to MySQL server` | MySQL is not started. In XAMPP click Start next to MySQL |
| `Check constraint ... is violated` | a room number must match its floor: 1st = 101-199, 2nd = 201-299, ... |

Next: go to `backend/README.md`.
