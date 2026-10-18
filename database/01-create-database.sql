-- SafeZone database, step 1 of 3.
-- Run this ONCE as the MySQL admin (root). It creates the database and a limited user
-- that the backend uses. The backend user can read and write data but cannot change the table design.
--
-- BEFORE YOU RUN IT: change CHANGE_THIS_PASSWORD below to your own password, and use the same
-- password later in backend/.env (DB_PASSWORD).

CREATE DATABASE IF NOT EXISTS safezone
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'safezone_app'@'localhost' IDENTIFIED BY '';
GRANT SELECT, INSERT, UPDATE, DELETE ON safezone.* TO 'safezone_app'@'localhost';
FLUSH PRIVILEGES;
