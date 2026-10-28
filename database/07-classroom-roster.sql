-- Existing databases: run after migrations 01–06. Safe to rerun.
-- Adds missing classrooms without overwriting accounts, rooms, devices or readings.
-- Excluded rooms remain stored for history; the API hides them from classroom use.
-- Legacy lighting data is retained; the app no longer configures or estimates lighting.
USE safezone;
START TRANSACTION;
INSERT IGNORE INTO rooms (floor_no, room_no, lights) VALUES
  (1,101,0),
  (1,102,0),
  (1,103,0),
  (1,104,0),
  (1,105,0),
  (1,106,0),
  (1,107,0),
  (1,109,0),
  (1,110,0),
  (1,111,0),
  (1,112,0),
  (2,201,0),
  (2,202,0),
  (2,203,0),
  (2,204,0),
  (2,206,0),
  (2,207,0),
  (2,208,0),
  (2,209,0),
  (2,211,0),
  (2,212,0),
  (3,301,0),
  (3,302,0),
  (3,303,0),
  (3,304,0),
  (3,305,0),
  (3,306,0),
  (3,308,0),
  (3,310,0),
  (3,311,0),
  (3,312,0),
  (4,401,0),
  (4,402,0),
  (4,403,0),
  (4,404,0),
  (4,405,0),
  (4,406,0),
  (4,407,0),
  (4,408,0),
  (4,409,0),
  (4,410,0),
  (4,411,0),
  (4,412,0);
INSERT INTO room_devices (room_id,device_type,label,quantity,watts_per_device,fan_type)
SELECT r.id,'exhaust_fan','Exhaust fan',1,r.fan_watts,'unspecified'
FROM rooms r WHERE r.room_no NOT IN (108,205,210,307,309) AND r.fan_watts>0
AND NOT EXISTS (SELECT 1 FROM room_devices d WHERE d.room_id=r.id AND d.device_type='exhaust_fan');
UPDATE room_devices SET device_type='esp8266',label=REPLACE(REPLACE(label,'ESP32 Controller','NodeMCU V3 ESP8266'),'ESP32','NodeMCU V3 ESP8266') WHERE device_type='esp32';
COMMIT;
SELECT floor_no,COUNT(*) AS classroom_count FROM rooms
WHERE room_no NOT IN (108,205,210,307,309) GROUP BY floor_no;
