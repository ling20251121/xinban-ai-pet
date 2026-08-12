CREATE TABLE `sandbox_state` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_token` text NOT NULL,
	`initialized_at` text NOT NULL,
	CONSTRAINT `sandbox_state_id_check` CHECK(`id` = 'synthetic-school')
);
--> statement-breakpoint
ALTER TABLE `school_classes` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_users` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mood_entries` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `support_events` ADD COLUMN `synthetic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_school_classes_synthetic_teacher` ON `school_classes` (`synthetic`,`teacher_user_id`,`active`);
--> statement-breakpoint
CREATE INDEX `idx_app_users_synthetic_role` ON `app_users` (`synthetic`,`role`,`active`);
--> statement-breakpoint
CREATE INDEX `idx_mood_entries_synthetic_user` ON `mood_entries` (`synthetic`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_synthetic_user` ON `chat_conversations` (`synthetic`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_synthetic_user` ON `chat_messages` (`synthetic`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_support_events_synthetic_class` ON `support_events` (`synthetic`,`class_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
