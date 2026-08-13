BEGIN;

ALTER TABLE evaluation_surveys
  ADD COLUMN IF NOT EXISTS student_ui_presentation_fidelity_score INTEGER
    CHECK (student_ui_presentation_fidelity_score IS NULL OR student_ui_presentation_fidelity_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_ui_potential_usefulness_score INTEGER
    CHECK (student_ui_potential_usefulness_score IS NULL OR student_ui_potential_usefulness_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_ui_perceived_comprehensibility_score INTEGER
    CHECK (student_ui_perceived_comprehensibility_score IS NULL OR student_ui_perceived_comprehensibility_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_ui_age_context_fit_score INTEGER
    CHECK (student_ui_age_context_fit_score IS NULL OR student_ui_age_context_fit_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_ui_items_version TEXT;

INSERT INTO schema_migrations(version, applied_at)
VALUES ('0007_student_ui_formative_items', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (version) DO NOTHING;

COMMIT;
