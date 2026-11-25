-- Run once as the database administrator. Safe to run again; preserves all existing data.
USE safezone;
CREATE TABLE IF NOT EXISTS simulation_history (
  room_id INT UNSIGNED NOT NULL,
  bucket_ms BIGINT UNSIGNED NOT NULL,
  first_ms BIGINT UNSIGNED NOT NULL,
  last_ms BIGINT UNSIGNED NOT NULL,
  samples INT UNSIGNED NOT NULL,
  temp_sum DOUBLE NOT NULL, temp_min DOUBLE NOT NULL, temp_max DOUBLE NOT NULL,
  hum_sum DOUBLE NOT NULL, hum_min DOUBLE NOT NULL, hum_max DOUBLE NOT NULL,
  co2_sum DOUBLE NOT NULL, co2_min DOUBLE NOT NULL, co2_max DOUBLE NOT NULL,
  PRIMARY KEY (room_id,bucket_ms),
  KEY ix_simulation_history_retention (bucket_ms),
  CONSTRAINT fk_simulation_history_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;
