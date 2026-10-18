-- SafeZone database, step 2 of 3: the tables.
-- Run as root. Safe to run again: it only creates tables that are missing.
-- Works on MySQL 8 and on the MariaDB that comes with XAMPP.

USE safezone;

-- ---------------------------------------------------------------------------
-- users: every account. role = 'admin' (logs in with a username)
--                       or   'viewer' (student / faculty, logs in with the mobile number)
-- Passwords are NEVER stored as text, only the bcrypt hash.
-- token_version goes up whenever the password changes, which logs the person out everywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role           ENUM('admin','viewer') NOT NULL,
  username       VARCHAR(20)  NULL,
  full_name      VARCHAR(100) NULL,
  email          VARCHAR(120) NOT NULL,                 -- PUP web mail, lower case
  email_kind     ENUM('student','faculty') NOT NULL,    -- decided by the web mail domain
  phone          CHAR(11)     NOT NULL,                 -- 09XXXXXXXXX
  password_hash  VARCHAR(100) NOT NULL,
  token_version  INT UNSIGNED NOT NULL DEFAULT 0,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT chk_users_admin_username CHECK (role <> 'admin' OR username IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- password_resets: one row per forgot-password request.
-- Only a hash of the 6-digit code is stored. Times are set by the database clock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  code_hash    CHAR(64)     NOT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- wrong guesses so far (max 5)
  expires_at   DATETIME     NOT NULL,
  verified_at  DATETIME     NULL,                     -- set when the right code was typed
  used_at      DATETIME     NULL,                     -- set when the new password was saved
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_resets_user (user_id, created_at),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- rooms: floor 1 = rooms 101-199, floor 2 = 201-299, floor 3 = 301-399, floor 4 = 401-499.
-- device_id is how the room is linked to its ESP32 / Firebase path later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  floor_no         TINYINT UNSIGNED  NOT NULL,
  room_no          SMALLINT UNSIGNED NOT NULL,
  lights           SMALLINT UNSIGNED NOT NULL DEFAULT 8,
  watts_per_light  DECIMAL(6,1) NOT NULL DEFAULT 18.0,
  fan_watts        DECIMAL(6,1) NOT NULL DEFAULT 40.0,
  vent_mode        ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  device_id        VARCHAR(40) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rooms_room_no (room_no),
  UNIQUE KEY uq_rooms_device (device_id),
  CONSTRAINT chk_rooms_number CHECK (room_no BETWEEN floor_no * 100 + 1 AND floor_no * 100 + 99)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- thresholds: the warning and limit for each reading (same for every room).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS thresholds (
  metric       ENUM('temp','hum','co2') NOT NULL,
  warn_value   DECIMAL(7,2) NOT NULL,
  limit_value  DECIMAL(7,2) NOT NULL,
  updated_by   INT UNSIGNED NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (metric),
  CONSTRAINT chk_thresholds_order CHECK (warn_value < limit_value),
  CONSTRAINT fk_thresholds_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- settings: small system-wide options. fan_trigger = 'warning' (yellow) or 'exceeded' (red).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  setting_key    VARCHAR(50)  NOT NULL,
  setting_value  VARCHAR(255) NOT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- sms_recipients: who gets a text when a room reaches Warning or Danger.
-- user_id links the entry to an account when the person registered.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_recipients (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(100) NOT NULL,
  role         VARCHAR(30)  NOT NULL,
  phone        CHAR(11)     NOT NULL,
  sms_enabled  TINYINT(1)   NOT NULL DEFAULT 1,
  user_id      INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sms_phone (phone),
  CONSTRAINT fk_sms_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- alerts: the Alerts list in the app (warnings, danger, ventilation, back to normal).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id        INT UNSIGNED NULL,
  type           ENUM('normal','warning','exceeded','ventilation') NOT NULL,
  title          VARCHAR(100) NOT NULL,
  body           VARCHAR(255) NOT NULL,
  metric         ENUM('temp','hum','co2') NULL,
  reading_value  DECIMAL(8,2) NULL,
  sms_sent       SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- how many people were texted
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_alerts_room_time (room_id, created_at),
  KEY ix_alerts_time (created_at),
  CONSTRAINT fk_alerts_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- notification_log: every SMS and email the system tried to send (never the codes themselves).
-- Handy for your "SMS delivery" test results.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  purpose     ENUM('alert','password_reset') NOT NULL,
  channel     ENUM('sms','email') NOT NULL,
  to_address  VARCHAR(120) NOT NULL,
  alert_id    BIGINT UNSIGNED NULL,
  user_id     INT UNSIGNED NULL,
  status      ENUM('queued','sent','failed') NOT NULL,
  error       VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notif_created (created_at),
  CONSTRAINT fk_notif_alert FOREIGN KEY (alert_id) REFERENCES alerts (id) ON DELETE SET NULL,
  CONSTRAINT fk_notif_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- system_logs: faults and events (sensor failure, fan not responding, Wi-Fi lost, ...).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  level       ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  source      VARCHAR(40)  NOT NULL,
  message     VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_syslog_time (created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- device_status: the Devices screen (esp32, temp_sensor, hum_sensor, co2_sensor, fan, wifi, sms_module, power_meter).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_status (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id    INT UNSIGNED NOT NULL,
  device     VARCHAR(30)  NOT NULL,
  status     ENUM('online','offline','fault') NOT NULL DEFAULT 'offline',
  detail     VARCHAR(100) NULL,
  last_seen  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_room (room_id, device),
  CONSTRAINT fk_device_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- reading_hourly: OPTIONAL, for later. One summary row per room per hour (average, lowest, highest).
-- Live readings stay in Firebase; these summaries keep the History charts and reports small and fast.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_hourly (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id      INT UNSIGNED NOT NULL,
  hour_start   DATETIME NOT NULL,
  samples      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  temp_avg     DECIMAL(5,2) NULL, temp_min DECIMAL(5,2) NULL, temp_max DECIMAL(5,2) NULL,
  hum_avg      DECIMAL(5,2) NULL, hum_min  DECIMAL(5,2) NULL, hum_max  DECIMAL(5,2) NULL,
  co2_avg      DECIMAL(7,1) NULL, co2_min  DECIMAL(7,1) NULL, co2_max  DECIMAL(7,1) NULL,
  power_avg_w  DECIMAL(7,1) NULL,
  energy_kwh   DECIMAL(8,3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hourly_room_hour (room_id, hour_start),
  CONSTRAINT fk_hourly_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB;
