-- SafeZone database, step 3 of 3: starting data.
-- Run as root after 02-schema.sql. Safe to run again (it never overwrites existing rows).
-- The first ADMIN account is NOT created here, because passwords do not belong in a file.
-- You create it from the backend with:  npm run create-admin

USE safezone;

-- Default limits (change them later in the app: Settings).
INSERT IGNORE INTO thresholds (metric, warn_value, limit_value) VALUES
  ('temp', 30, 32),
  ('hum',  65, 75),
  ('co2',  1000, 1200);

-- Ventilation starts at red (Danger). The app can switch this to yellow (Warning).
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('fan_trigger', 'exceeded');

-- 1st floor: Room 101 to Room 110. Floors 2, 3 and 4 start empty.
INSERT IGNORE INTO rooms (floor_no, room_no) VALUES
  (1,101),(1,102),(1,103),(1,104),(1,105),(1,106),(1,107),(1,108),(1,109),(1,110);

-- Every room starts with its devices marked offline until the hardware reports in.
INSERT IGNORE INTO device_status (room_id, device)
SELECT r.id, d.device
FROM rooms r
CROSS JOIN (
  SELECT 'esp32' AS device UNION ALL SELECT 'temp_sensor' UNION ALL SELECT 'hum_sensor'
  UNION ALL SELECT 'co2_sensor' UNION ALL SELECT 'fan' UNION ALL SELECT 'wifi'
  UNION ALL SELECT 'sms_module' UNION ALL SELECT 'power_meter'
) d;
