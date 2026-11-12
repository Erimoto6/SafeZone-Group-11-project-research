-- Run after 09. Per-user archive bookmarks; original alert records are retained.
USE safezone;
CREATE TABLE IF NOT EXISTS alert_archives (
 user_id INT UNSIGNED NOT NULL,
 alert_id BIGINT UNSIGNED NOT NULL,
 archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,alert_id),
 CONSTRAINT fk_archive_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT fk_archive_alert FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
