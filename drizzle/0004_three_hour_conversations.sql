PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_chat_conversations` (
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
	`synthetic` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `chat_conversations_turns_check` CHECK(`student_turns` >= 0),
	CONSTRAINT `chat_conversations_in_flight_check` CHECK(`in_flight` IN (0, 1)),
	CONSTRAINT `chat_conversations_synthetic_check` CHECK(`synthetic` IN (0, 1)),
	CONSTRAINT `chat_conversations_end_reason_check` CHECK(`ended_reason` IS NULL OR `ended_reason` IN ('expired', 'turn_limit', 'urgent', 'student_deleted', 'student_finished'))
);
--> statement-breakpoint
INSERT INTO `__new_chat_conversations` SELECT * FROM `chat_conversations`;
--> statement-breakpoint
DROP TABLE `chat_conversations`;
--> statement-breakpoint
ALTER TABLE `__new_chat_conversations` RENAME TO `chat_conversations`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_user_created` ON `chat_conversations` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_conversations_one_open_user` ON `chat_conversations` (`user_id`) WHERE `ended_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_synthetic_user` ON `chat_conversations` (`synthetic`,`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `teacher_attention_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`assigned_teacher_user_id` text,
	`acknowledged_at` text,
	`resolved_at` text,
	`synthetic` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `teacher_attention_events_kind_source_check` CHECK((`kind` = 'long_chat_session' AND `source_type` = 'chat') OR (`kind` = 'student_support_request' AND `source_type` = 'mood')),
	CONSTRAINT `teacher_attention_events_status_check` CHECK(`status` IN ('new', 'acknowledged', 'resolved')),
	CONSTRAINT `teacher_attention_events_synthetic_check` CHECK(`synthetic` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_teacher_attention_events_kind_source` ON `teacher_attention_events` (`kind`,`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_teacher_attention_events_class_created` ON `teacher_attention_events` (`class_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_teacher_attention_events_user_created` ON `teacher_attention_events` (`user_id`,`created_at`);
