-- Local revision: run as the database administrator after step 04.
-- Separate accumulated estimates from simulation resets. Existing data is retained.
USE safezone;
CREATE TABLE IF NOT EXISTS electricity_usage (
  room_id INT UNSIGNED NOT NULL,
  lights_kwh DOUBLE NOT NULL DEFAULT 0,
  fan_kwh DOUBLE NOT NULL DEFAULT 0,
  operating_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id),
  CONSTRAINT fk_electricity_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;
