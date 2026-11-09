-- Run after 08. Add course/section without modifying existing account details.
USE safezone;
CREATE TABLE IF NOT EXISTS student_profiles (
 user_id INT UNSIGNED NOT NULL,
 course_code VARCHAR(16) NOT NULL,
 section VARCHAR(40) NOT NULL,
 PRIMARY KEY(user_id),
 CONSTRAINT fk_student_profile_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Existing students remain usable; they can add their profile in Account Settings.
