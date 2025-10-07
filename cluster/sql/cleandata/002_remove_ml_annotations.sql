-- Remove redundant ml_annotations table
-- Annotations are managed by Label Studio and exported to Hugging Face
-- PostgreSQL should only store cleaned vessel data, not ML training artifacts

DROP TABLE IF EXISTS cleandata.ml_annotations CASCADE;

-- Update comments to reflect correct architecture
COMMENT ON TABLE cleandata.vessels IS 'Core vessel registry data with JSONB for flexible schema across RFMOs. Annotations are managed in Label Studio and exported to Hugging Face for model training.';
COMMENT ON TABLE cleandata.vessel_changes IS 'Audit trail for all changes to vessel records. Links to Label Studio task IDs for traceability.';

COMMENT ON COLUMN cleandata.vessel_changes.label_studio_task_id IS 'Optional: Links to Label Studio annotation task that resulted in this change';
