CREATE TABLE `mood_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_hash` text NOT NULL,
	`participant_code` text NOT NULL,
	`mood` text NOT NULL,
	`mood_score` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`wants_support` integer DEFAULT false NOT NULL,
	`safety_level` text DEFAULT 'normal' NOT NULL,
	`support_evidence` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "mood_entries_score_check" CHECK("mood_entries"."mood_score" BETWEEN 0 AND 5),
	CONSTRAINT "mood_entries_support_check" CHECK("mood_entries"."wants_support" IN (0, 1)),
	CONSTRAINT "mood_entries_safety_check" CHECK("mood_entries"."safety_level" IN ('normal', 'urgent'))
);
--> statement-breakpoint
CREATE INDEX `idx_mood_entries_participant_created` ON `mood_entries` (`participant_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mood_entries_created` ON `mood_entries` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mood_entries_flagged_created` ON `mood_entries` (`created_at`) WHERE "mood_entries"."wants_support" = 1 OR "mood_entries"."safety_level" = 'urgent';--> statement-breakpoint
PRAGMA optimize;
