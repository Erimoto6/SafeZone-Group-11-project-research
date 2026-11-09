-- Run once as the database administrator in phpMyAdmin. Safe to run again.
-- Keeps shared demo readings separate from future real sensor data.
USE safezone;
CREATE TABLE IF NOT EXISTS simulation_state (
  room_id INT UNSIGNED NOT NULL,
  temp DOUBLE NOT NULL DEFAULT 27.4,
  hum DOUBLE NOT NULL DEFAULT 58,
  co2 DOUBLE NOT NULL DEFAULT 827,
  scenario VARCHAR(4) NULL,
  start_value DOUBLE NULL,
  fan_on TINYINT(1) NOT NULL DEFAULT 0,
  temp_level VARCHAR(8) NOT NULL DEFAULT 'normal',
  hum_level VARCHAR(8) NOT NULL DEFAULT 'normal',
  co2_level VARCHAR(8) NOT NULL DEFAULT 'normal',
  last_step_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id),
  CONSTRAINT fk_simulation_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;
