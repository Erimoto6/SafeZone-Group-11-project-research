-- Local review revision. Run after 05 as the database administrator.
USE safezone;
CREATE TABLE IF NOT EXISTS room_devices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id INT UNSIGNED NOT NULL,
  device_type VARCHAR(24) NOT NULL,
  label VARCHAR(100) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  active_quantity SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  watts_per_device DOUBLE NOT NULL DEFAULT 0,
  fan_type VARCHAR(24) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_room_device_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Preserve existing ratings and simulated light switch counts. Never overwrite edited devices.
INSERT INTO room_devices (room_id,device_type,label,quantity,active_quantity,watts_per_device)
SELECT r.id,'light','Existing lights',r.lights,ROUND(r.lights*0.75),r.watts_per_light
FROM rooms r WHERE r.lights>0 AND NOT EXISTS (SELECT 1 FROM room_devices d WHERE d.room_id=r.id AND d.device_type='light');
INSERT INTO room_devices (room_id,device_type,label,quantity,watts_per_device,fan_type)
SELECT r.id,'exhaust_fan','Existing exhaust fan',1,r.fan_watts,'unspecified'
FROM rooms r WHERE r.fan_watts>0 AND NOT EXISTS (SELECT 1 FROM room_devices d WHERE d.room_id=r.id AND d.device_type='exhaust_fan');
