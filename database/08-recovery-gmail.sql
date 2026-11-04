-- Run after 07. Adds recovery Gmail without changing account/login emails.
USE safezone;
CREATE TABLE IF NOT EXISTS account_recovery (
  user_id INT UNSIGNED NOT NULL,
  email VARCHAR(254) NULL,
  pending_email VARCHAR(254) NULL,
  code_hash CHAR(64) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  requested_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Run once during this upgrade: existing PUP-address reset codes stop working.
DELETE FROM password_resets WHERE used_at IS NULL;
