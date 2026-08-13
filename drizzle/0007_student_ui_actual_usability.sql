CREATE TABLE `evaluation_student_ui_task_runs` (
	`participant_id` text NOT NULL,
	`task_version` text NOT NULL,
	`task_id` text NOT NULL CHECK (`task_id` IN ('mood_select','fixed_expression','support_tool')),
	`status` text NOT NULL CHECK (`status` IN ('in_progress','success','unable')),
	`error_count` integer NOT NULL DEFAULT 0 CHECK (`error_count` BETWEEN 0 AND 20),
	`unable_reason` text CHECK (`unable_reason` IS NULL OR `unable_reason` IN ('could_not_find','unclear_instruction','other_no_text')),
	`started_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer CHECK (`duration_ms` IS NULL OR `duration_ms` BETWEEN 0 AND 604800000),
	PRIMARY KEY(`participant_id`, `task_version`, `task_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_eval_student_ui_task_version` ON `evaluation_student_ui_task_runs` (`task_version`,`task_id`,`participant_id`);
--> statement-breakpoint
CREATE TABLE `evaluation_student_ui_task_feedback` (
	`participant_id` text NOT NULL,
	`task_version` text NOT NULL,
	`actual_ease_score` integer NOT NULL CHECK (`actual_ease_score` BETWEEN 1 AND 5),
	`rated_at` text NOT NULL,
	PRIMARY KEY(`participant_id`, `task_version`)
);
