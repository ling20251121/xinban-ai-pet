ALTER TABLE `mood_entries` ADD COLUMN `user_id` text;
--> statement-breakpoint
ALTER TABLE `mood_entries` ADD COLUMN `class_id` text;
--> statement-breakpoint
CREATE TABLE `school_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_user_id` text NOT NULL,
	`name` text NOT NULL,
	`safety_contact_name` text NOT NULL,
	`safety_contact_phone` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `school_classes_active_check` CHECK(`active` IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_school_classes_teacher` ON `school_classes` (`teacher_user_id`,`active`);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`class_id` text,
	`age_band` text,
	`must_change_password` integer DEFAULT true NOT NULL,
	`guardian_consent_verified_at` text,
	`guardian_consent_verified_by` text,
	`student_consented_at` text,
	`student_consent_version` text,
	`student_consent_withdrawn_at` text,
	`created_by_user_id` text,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `app_users_role_check` CHECK(`role` IN ('teacher', 'student')),
	CONSTRAINT `app_users_active_check` CHECK(`active` IN (0, 1)),
	CONSTRAINT `app_users_password_change_check` CHECK(`must_change_password` IN (0, 1)),
	CONSTRAINT `app_users_password_iterations_check` CHECK(`password_iterations` >= 210000),
	CONSTRAINT `app_users_class_check` CHECK((`role` = 'teacher' AND `class_id` IS NULL AND `age_band` IS NULL) OR (`role` = 'student' AND `class_id` IS NOT NULL AND `age_band` IN ('under14', '14plus')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_username_unique` ON `app_users` (`username`);
--> statement-breakpoint
CREATE INDEX `idx_app_users_class_role_active` ON `app_users` (`class_id`,`role`,`active`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expiry` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`request_count` integer NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT `auth_rate_limits_count_check` CHECK(`request_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_auth_rate_limits_expiry` ON `auth_rate_limits` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`started_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`student_turns` integer DEFAULT 0 NOT NULL,
	`in_flight` integer DEFAULT false NOT NULL,
	`pending_since` text,
	`lease_token` text,
	`ended_reason` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `chat_conversations_turns_check` CHECK(`student_turns` BETWEEN 0 AND 12),
	CONSTRAINT `chat_conversations_in_flight_check` CHECK(`in_flight` IN (0, 1)),
	CONSTRAINT `chat_conversations_end_reason_check` CHECK(`ended_reason` IS NULL OR `ended_reason` IN ('expired', 'turn_limit', 'urgent', 'student_deleted'))
);
--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_user_created` ON `chat_conversations` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_conversations_one_open_user` ON `chat_conversations` (`user_id`) WHERE `ended_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`safety_level` text DEFAULT 'normal' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `chat_messages_role_check` CHECK(`role` IN ('user', 'assistant', 'local_safety')),
	CONSTRAINT `chat_messages_safety_check` CHECK(`safety_level` IN ('normal', 'urgent'))
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_conversation_created` ON `chat_messages` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_user_created` ON `chat_messages` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `support_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`safety_level` text NOT NULL,
	`evidence_code` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`assigned_teacher_user_id` text,
	`acknowledged_at` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `support_events_source_check` CHECK(`source_type` IN ('mood', 'chat', 'voice')),
	CONSTRAINT `support_events_safety_check` CHECK(`safety_level` = 'urgent'),
	CONSTRAINT `support_events_evidence_check` CHECK(`evidence_code` = 'local_crisis_rule'),
	CONSTRAINT `support_events_status_check` CHECK(`status` IN ('new', 'acknowledged', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `idx_support_events_class_created` ON `support_events` (`class_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_support_events_user_created` ON `support_events` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_mood_entries_user_created` ON `mood_entries` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_mood_entries_class_created` ON `mood_entries` (`class_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
