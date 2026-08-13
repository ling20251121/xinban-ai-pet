ALTER TABLE `evaluation_surveys` ADD COLUMN `student_ui_presentation_fidelity_score` integer
  CHECK (`student_ui_presentation_fidelity_score` IS NULL OR `student_ui_presentation_fidelity_score` BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE `evaluation_surveys` ADD COLUMN `student_ui_potential_usefulness_score` integer
  CHECK (`student_ui_potential_usefulness_score` IS NULL OR `student_ui_potential_usefulness_score` BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE `evaluation_surveys` ADD COLUMN `student_ui_perceived_comprehensibility_score` integer
  CHECK (`student_ui_perceived_comprehensibility_score` IS NULL OR `student_ui_perceived_comprehensibility_score` BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE `evaluation_surveys` ADD COLUMN `student_ui_age_context_fit_score` integer
  CHECK (`student_ui_age_context_fit_score` IS NULL OR `student_ui_age_context_fit_score` BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE `evaluation_surveys` ADD COLUMN `student_ui_items_version` text;
