CREATE TABLE `conversation_cues` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`window_turn` integer NOT NULL,
	`observed_expression` text NOT NULL,
	`themes_json` text NOT NULL,
	`follow_up` text NOT NULL,
	`trend` text NOT NULL,
	`confidence` text NOT NULL,
	`basis_json` text NOT NULL,
	`analyzer_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`assigned_teacher_user_id` text,
	`acknowledged_at` text,
	`resolved_at` text,
	`dismissed_at` text,
	`synthetic` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `conversation_cues_window_check` CHECK(`window_turn` > 0 AND `window_turn` % 3 = 0),
	CONSTRAINT `conversation_cues_expression_check` CHECK(`observed_expression` IN ('positive','neutral','mixed','distress','unclear')),
	CONSTRAINT `conversation_cues_follow_up_check` CHECK(`follow_up` IN ('routine_check_in','timely_check_in')),
	CONSTRAINT `conversation_cues_trend_check` CHECK(`trend` IN ('not_enough_data','stable','easing','intensifying','unclear')),
	CONSTRAINT `conversation_cues_confidence_check` CHECK(`confidence` IN ('low','medium','high')),
	CONSTRAINT `conversation_cues_status_check` CHECK(`status` IN ('new','acknowledged','resolved','dismissed_inaccurate')),
	CONSTRAINT `conversation_cues_synthetic_check` CHECK(`synthetic` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_cues_window` ON `conversation_cues` (`conversation_id`,`window_turn`);
--> statement-breakpoint
CREATE INDEX `idx_conversation_cues_class_created` ON `conversation_cues` (`class_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_conversation_cues_user_created` ON `conversation_cues` (`user_id`,`created_at`);
