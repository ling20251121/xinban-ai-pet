CREATE TABLE `evaluation_dialogues` (
  `participant_id` text NOT NULL,
  `scenario_id` text NOT NULL,
  `dialogue_pack_version` text NOT NULL,
  `dialogue_prompt_version` text NOT NULL,
  `model_id` text,
  `status` text DEFAULT 'ready' NOT NULL,
  `next_turn` integer DEFAULT 0 NOT NULL,
  `lease_token` text,
  `lease_started_at` text,
  `transcript_json` text DEFAULT '[]' NOT NULL,
  `provider_metadata_json` text DEFAULT '[]' NOT NULL,
  `total_latency_ms` integer DEFAULT 0 NOT NULL,
  `safety_ended` integer DEFAULT 0 NOT NULL,
  `rating_json` text,
  `rating_token` text,
  `must_revise` integer,
  `harm_flags_json` text,
  `started_at` text,
  `completed_at` text,
  `rated_at` text,
  `updated_at` text NOT NULL,
  PRIMARY KEY(`participant_id`,`scenario_id`),
  CONSTRAINT `evaluation_dialogues_status_check` CHECK(`status` IN ('ready','in_flight','completed')),
  CONSTRAINT `evaluation_dialogues_turn_check` CHECK(`next_turn` BETWEEN 0 AND 3),
  CONSTRAINT `evaluation_dialogues_safety_check` CHECK(`safety_ended` IN (0,1)),
  CONSTRAINT `evaluation_dialogues_revise_check` CHECK(`must_revise` IS NULL OR `must_revise` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_eval_dialogue_participant` ON `evaluation_dialogues` (`participant_id`,`scenario_id`);
--> statement-breakpoint
PRAGMA optimize;
