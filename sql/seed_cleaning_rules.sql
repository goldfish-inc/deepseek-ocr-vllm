-- Extracted cleaning rules from legacy pandas scripts
-- Generated: 2025-09-30
-- Source: scripts/legacy-pandas-cleaners/

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS stage;

-- Ensure cleaning_rules table exists (should be created by migration)
-- See sql/migrations/001_create_staging_schema.sql

-- Rules from COUNTRY_ALL (14 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_field_merger_0',
  'field_merger',
  'COUNTRY',
  NULL,
  ' ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 24}',
  100,
  'clean_all_vessel_types.py:24',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_1',
  'string_replace',
  'COUNTRY',
  NULL,
  '.',
  NULL,
  '{"comment": "Standardize field names: spaces to underscores, strip whitespace", "line": 53}',
  100,
  'clean_all_vessel_types.py:53',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_2',
  'string_replace',
  'COUNTRY',
  NULL,
  ')',
  NULL,
  '{"comment": "Standardize field names: spaces to underscores, strip whitespace", "line": 53}',
  100,
  'clean_all_vessel_types.py:53',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_3',
  'string_replace',
  'COUNTRY',
  NULL,
  '(',
  NULL,
  '{"comment": "Standardize field names: spaces to underscores, strip whitespace", "line": 53}',
  100,
  'clean_all_vessel_types.py:53',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_4',
  'string_replace',
  'COUNTRY',
  NULL,
  ' ',
  '_',
  '{"comment": "Standardize field names: spaces to underscores, strip whitespace", "line": 53}',
  100,
  'clean_all_vessel_types.py:53',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_delimiter_detection_5',
  'delimiter_detection',
  'COUNTRY',
  NULL,
  '_',
  NULL,
  '{"comment": "Extract source name from filename: ITA_vessels_2025-09-08.csv → ITA", "line": 88}',
  100,
  'clean_all_vessel_types.py:88',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_field_merger_6',
  'field_merger',
  'COUNTRY',
  NULL,
  ', ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 110}',
  100,
  'clean_all_vessel_types.py:110',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_7',
  'string_replace',
  'COUNTRY',
  NULL,
  ')',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 174}',
  100,
  'clean_chile_excel.py:174',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_8',
  'string_replace',
  'COUNTRY',
  NULL,
  '(',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 174}',
  100,
  'clean_chile_excel.py:174',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_9',
  'string_replace',
  'COUNTRY',
  NULL,
  ' ',
  '_',
  '{"comment": "Auto-extracted from legacy script", "line": 174}',
  100,
  'clean_chile_excel.py:174',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_delimiter_detection_10',
  'delimiter_detection',
  'COUNTRY',
  NULL,
  '_',
  NULL,
  '{"comment": "Extract region from filename: CHL_region_I_RPA_2025-09-08.xlsx -> I", "line": 207}',
  100,
  'clean_chile_excel.py:207',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_delimiter_detection_11',
  'delimiter_detection',
  'COUNTRY',
  NULL,
  'region_',
  NULL,
  '{"comment": "Extract region from filename: CHL_region_I_RPA_2025-09-08.xlsx -> I", "line": 207}',
  100,
  'clean_chile_excel.py:207',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_12',
  'string_replace',
  'COUNTRY',
  NULL,
  '_2025-09-08',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 209}',
  100,
  'clean_chile_excel.py:209',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_all_string_replace_13',
  'string_replace',
  'COUNTRY',
  NULL,
  'CHL_',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 209}',
  100,
  'clean_chile_excel.py:209',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from COUNTRY_EU_BGR (16 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_encoding_strategy_0',
  'encoding_strategy',
  'COUNTRY',
  'EU_BGR',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "Read with UTF-8 encoding to handle Cyrillic", "line": 27}',
  150,
  'clean_bgr_vessels.py:27',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_quote_fix_1',
  'quote_fix',
  'COUNTRY',
  'EU_BGR',
  'СВ",НИКОЛА',
  'СВ,НИКОЛА',
  '{"comment": "1: СВ",НИКОЛА pattern - quote within vessel name", "line": 44}',
  250,
  'clean_bgr_vessels.py:44',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_count_mismatch_2',
  'field_count_mismatch',
  'COUNTRY',
  'EU_BGR',
  'field_count_validation',
  NULL,
  '{"comment": "Try to parse with custom logic", "line": 58}',
  150,
  'clean_bgr_vessels.py:58',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_merger_3',
  'field_merger',
  'COUNTRY',
  'EU_BGR',
  ';',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 96}',
  150,
  'clean_bgr_vessels.py:96',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_encoding_strategy_4',
  'encoding_strategy',
  'COUNTRY',
  'EU_BGR',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 110}',
  150,
  'clean_bgr_vessels.py:110',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_quote_fix_5',
  'quote_fix',
  'COUNTRY',
  'EU_BGR',
  'СВ",НИКОЛА',
  'СВ,НИКОЛА',
  '{"comment": "The specific pattern mentioned in error: СВ",НИКОЛА", "line": 15}',
  250,
  'clean_bgr_robust.py:15',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_encoding_strategy_6',
  'encoding_strategy',
  'COUNTRY',
  'EU_BGR',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "File encoding configuration", "line": 50}',
  150,
  'clean_bgr_robust.py:50',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_pattern_detection_7',
  'pattern_detection',
  'COUNTRY',
  'EU_BGR',
  '([А-Яа-я]+)"([А-Яа-я,\s]+)',
  NULL,
  '{"comment": "Find other Cyrillic quote patterns", "line": 87}',
  150,
  'clean_bgr_robust.py:87',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_count_too_few_8',
  'field_count_too_few',
  'COUNTRY',
  'EU_BGR',
  'field_count_validation',
  NULL,
  '{"comment": "Add missing fields", "line": 96}',
  150,
  'clean_bgr_robust.py:96',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_count_too_many_9',
  'field_count_too_many',
  'COUNTRY',
  'EU_BGR',
  'field_count_validation',
  NULL,
  '{"comment": "Too many fields - likely due to unescaped semicolons", "line": 101}',
  150,
  'clean_bgr_robust.py:101',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_delimiter_detection_10',
  'delimiter_detection',
  'COUNTRY',
  'EU_BGR',
  ';',
  NULL,
  '{"comment": "Try to merge fields that might have been split", "line": 104}',
  150,
  'clean_bgr_robust.py:104',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_merger_11',
  'field_merger',
  'COUNTRY',
  'EU_BGR',
  ';',
  NULL,
  '{"comment": "Keep first 40", "line": 113}',
  150,
  'clean_bgr_robust.py:113',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_encoding_strategy_12',
  'encoding_strategy',
  'COUNTRY',
  'EU_BGR',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 120}',
  150,
  'clean_bgr_robust.py:120',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_encoding_strategy_13',
  'encoding_strategy',
  'COUNTRY',
  'EU_BGR',
  'encoding=utf-8',
  NULL,
  '{"comment": "File encoding configuration", "line": 155}',
  150,
  'clean_bgr_robust.py:155',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_field_count_mismatch_14',
  'field_count_mismatch',
  'COUNTRY',
  'EU_BGR',
  'field_count_validation',
  NULL,
  '{"comment": "Field count validation logic", "line": 169}',
  150,
  'clean_bgr_robust.py:169',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_pattern_detection_15',
  'pattern_detection',
  'COUNTRY',
  'EU_BGR',
  '[А-Яа-я]"[А-Яа-я]',
  NULL,
  '{"comment": "Check for remaining quote issues", "line": 173}',
  150,
  'clean_bgr_robust.py:173',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from COUNTRY_EU_DNK (15 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_0',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "File encoding configuration", "line": 36}',
  150,
  'clean_dnk_robust.py:36',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_pattern_detection_1',
  'pattern_detection',
  'COUNTRY',
  'EU_DNK',
  '([^;]+)",[ ]([^;]+)',
  NULL,
  '{"comment": "Extract what patterns we found for reporting", "line": 60}',
  150,
  'clean_dnk_robust.py:60',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_count_too_few_2',
  'field_count_too_few',
  'COUNTRY',
  'EU_DNK',
  'field_count_validation',
  NULL,
  '{"comment": "Ensure correct number of fields", "line": 66}',
  150,
  'clean_dnk_robust.py:66',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_3',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 74}',
  150,
  'clean_dnk_robust.py:74',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_4',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8',
  NULL,
  '{"comment": "File encoding configuration", "line": 100}',
  150,
  'clean_dnk_robust.py:100',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_count_mismatch_5',
  'field_count_mismatch',
  'COUNTRY',
  'EU_DNK',
  'field_count_validation',
  NULL,
  '{"comment": "Check field count", "line": 106}',
  150,
  'clean_dnk_robust.py:106',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_6',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "File encoding configuration", "line": 19}',
  150,
  'clean_dnk_final.py:19',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_count_too_few_7',
  'field_count_too_few',
  'COUNTRY',
  'EU_DNK',
  'field_count_validation',
  NULL,
  '{"comment": "If missing fields, add empty fields at the end", "line": 58}',
  150,
  'clean_dnk_final.py:58',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_count_too_many_8',
  'field_count_too_many',
  'COUNTRY',
  'EU_DNK',
  'field_count_validation',
  NULL,
  '{"comment": "Try to fix by removing quotes that might be splitting fields", "line": 64}',
  150,
  'clean_dnk_final.py:64',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_delimiter_detection_9',
  'delimiter_detection',
  'COUNTRY',
  'EU_DNK',
  ';',
  NULL,
  '{"comment": "Try to fix by removing quotes that might be splitting fields", "line": 66}',
  150,
  'clean_dnk_final.py:66',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_merger_10',
  'field_merger',
  'COUNTRY',
  'EU_DNK',
  ';',
  NULL,
  '{"comment": "Truncate to expected number", "line": 70}',
  150,
  'clean_dnk_final.py:70',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_11',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 76}',
  150,
  'clean_dnk_final.py:76',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_12',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "Read raw lines to handle problematic CSV", "line": 26}',
  150,
  'clean_dnk_vessels.py:26',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_field_merger_13',
  'field_merger',
  'COUNTRY',
  'EU_DNK',
  ';',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 81}',
  150,
  'clean_dnk_vessels.py:81',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_encoding_strategy_14',
  'encoding_strategy',
  'COUNTRY',
  'EU_DNK',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 93}',
  150,
  'clean_dnk_vessels.py:93',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from COUNTRY_EU_ESP (13 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_encoding_strategy_0',
  'encoding_strategy',
  'COUNTRY',
  'EU_ESP',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "Read with UTF-8 to handle Spanish characters", "line": 27}',
  150,
  'clean_esp_vessels.py:27',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_quote_fix_1',
  'quote_fix',
  'COUNTRY',
  'EU_ESP',
  'Caleta Del Sebo", La',
  'Caleta Del Sebo, La',
  '{"comment": "1: "Caleta Del Sebo", La G... pattern", "line": 44}',
  250,
  'clean_esp_vessels.py:44',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_field_merger_2',
  'field_merger',
  'COUNTRY',
  'EU_ESP',
  ';',
  NULL,
  '{"comment": "Reconstruct line if we got the right field count", "line": 110}',
  150,
  'clean_esp_vessels.py:110',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_encoding_strategy_3',
  'encoding_strategy',
  'COUNTRY',
  'EU_ESP',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 123}',
  150,
  'clean_esp_vessels.py:123',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_encoding_strategy_4',
  'encoding_strategy',
  'COUNTRY',
  'EU_ESP',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "File encoding configuration", "line": 38}',
  150,
  'clean_esp_robust.py:38',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_pattern_detection_5',
  'pattern_detection',
  'COUNTRY',
  'EU_ESP',
  '([^;]+)",[ ]([^;]+)',
  NULL,
  '{"comment": "Extract what patterns we found for reporting", "line": 63}',
  150,
  'clean_esp_robust.py:63',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_field_count_too_few_6',
  'field_count_too_few',
  'COUNTRY',
  'EU_ESP',
  'field_count_validation',
  NULL,
  '{"comment": "Ensure correct number of fields", "line": 69}',
  150,
  'clean_esp_robust.py:69',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_field_count_too_many_7',
  'field_count_too_many',
  'COUNTRY',
  'EU_ESP',
  'field_count_validation',
  NULL,
  '{"comment": "Too many fields - truncate", "line": 74}',
  150,
  'clean_esp_robust.py:74',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_delimiter_detection_8',
  'delimiter_detection',
  'COUNTRY',
  'EU_ESP',
  ';',
  NULL,
  '{"comment": "Too many fields - truncate", "line": 76}',
  150,
  'clean_esp_robust.py:76',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_field_merger_9',
  'field_merger',
  'COUNTRY',
  'EU_ESP',
  ';',
  NULL,
  '{"comment": "Too many fields - truncate", "line": 79}',
  150,
  'clean_esp_robust.py:79',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_encoding_strategy_10',
  'encoding_strategy',
  'COUNTRY',
  'EU_ESP',
  'encoding=utf-8',
  NULL,
  '{"comment": "Write cleaned data", "line": 85}',
  150,
  'clean_esp_robust.py:85',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_encoding_strategy_11',
  'encoding_strategy',
  'COUNTRY',
  'EU_ESP',
  'encoding=utf-8',
  NULL,
  '{"comment": "File encoding configuration", "line": 119}',
  150,
  'clean_esp_robust.py:119',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_field_count_mismatch_12',
  'field_count_mismatch',
  'COUNTRY',
  'EU_ESP',
  'field_count_validation',
  NULL,
  '{"comment": "Field count validation logic", "line": 133}',
  150,
  'clean_esp_robust.py:133',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from REFERENCE_ALL (58 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_0',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '\(([^)]+)\)$',
  NULL,
  '{"comment": "Remove common prefixes like "Longfin squid" before scientific name", "line": 88}',
  100,
  'msc_fisheries_preprocessing.py:88',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_1',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '^([A-Z][a-z]+)\s*\(([A-Z][a-z]+)\)\s*(.+)$',
  NULL,
  '{"comment": "Handle complex nested parentheses like "Penaeus (Melicertus) latisulcatus"", "line": 94}',
  100,
  'msc_fisheries_preprocessing.py:94',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_regex_replace_2',
  'regex_replace',
  'REFERENCE',
  'ALL',
  '\s*\([^)]+\)\s*',
  ' ',
  '{"comment": "Auto-extracted from legacy script", "line": 101}',
  100,
  'msc_fisheries_preprocessing.py:101',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_3',
  'field_merger',
  'REFERENCE',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Remove "spp" or "sp" if it''s the second word", "line": 120}',
  100,
  'msc_fisheries_preprocessing.py:120',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_regex_replace_4',
  'regex_replace',
  'REFERENCE',
  'ALL',
  '\s+',
  ' ',
  '{"comment": "Auto-extracted from legacy script", "line": 122}',
  100,
  'msc_fisheries_preprocessing.py:122',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_5',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '^[A-Z][a-z]+',
  NULL,
  '{"comment": "Only keep names that look like valid scientific names", "line": 125}',
  100,
  'msc_fisheries_preprocessing.py:125',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_6',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '\b\d{1,2}\b',
  NULL,
  '{"comment": "Extract FAO area numbers using regex", "line": 139}',
  100,
  'msc_fisheries_preprocessing.py:139',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_7',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '\(([^)]+)\)',
  NULL,
  '{"comment": "Find all text in parentheses", "line": 199}',
  100,
  'msc_fisheries_preprocessing.py:199',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_regex_replace_8',
  'regex_replace',
  'REFERENCE',
  'ALL',
  '\s*\([^)]+\)\s*',
  NULL,
  '{"comment": "Get text outside parentheses (remove everything in parentheses)", "line": 202}',
  100,
  'msc_fisheries_preprocessing.py:202',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_9',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  ',',
  NULL,
  '{"comment": "Split by commas in case there are multiple codes outside parens", "line": 207}',
  100,
  'msc_fisheries_preprocessing.py:207',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_10',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '^[A-Z0-9\-]+',
  NULL,
  '{"comment": "Basic validation", "line": 209}',
  100,
  'msc_fisheries_preprocessing.py:209',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_11',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  ',',
  NULL,
  '{"comment": "Split by commas in case there are multiple codes in one parenthesis", "line": 215}',
  100,
  'msc_fisheries_preprocessing.py:215',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_12',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  '^[A-Z0-9\-]+',
  NULL,
  '{"comment": "Basic validation", "line": 217}',
  100,
  'msc_fisheries_preprocessing.py:217',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_13',
  'field_merger',
  'REFERENCE',
  'ALL',
  '|',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 312}',
  100,
  'msc_fisheries_preprocessing.py:312',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_14',
  'field_merger',
  'REFERENCE',
  'ALL',
  '|',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 324}',
  100,
  'msc_fisheries_preprocessing.py:324',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_15',
  'field_merger',
  'REFERENCE',
  'ALL',
  '|',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 331}',
  100,
  'msc_fisheries_preprocessing.py:331',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_16',
  'field_merger',
  'REFERENCE',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 15}',
  100,
  'clean_msc_fishery_light.py:15',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_17',
  'string_replace',
  'REFERENCE',
  'ALL',
  ' ',
  '_',
  '{"comment": "Auto-extracted from legacy script", "line": 23}',
  100,
  'clean_msc_fishery_light.py:23',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_18',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  '; ',
  NULL,
  '{"comment": "Split by ''; '' delimiter", "line": 89}',
  100,
  'clean_msc_gear_data.py:89',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_19',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.0',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 41}',
  100,
  'clean_reference_data.py:41',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_20',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.0',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 63}',
  100,
  'clean_reference_data.py:63',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_21',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.0',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 72}',
  100,
  'clean_reference_data.py:72',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_22',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.0',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 96}',
  100,
  'clean_reference_data.py:96',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_23',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  ';',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 98}',
  100,
  'clean_reference_data.py:98',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_24',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.0',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 142}',
  100,
  'clean_reference_data.py:142',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_25',
  'string_replace',
  'REFERENCE',
  'ALL',
  ';',
  '; ',
  '{"comment": "Auto-extracted from legacy script", "line": 159}',
  100,
  'clean_reference_data.py:159',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_26',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8',
  NULL,
  '{"comment": "Read the input CSV file", "line": 166}',
  100,
  'clean_asfis_data.py:166',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_27',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  ',',
  NULL,
  '{"comment": "Your existing pattern matching logic...", "line": 200}',
  100,
  'clean_asfis_data.py:200',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_28',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  ' x ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 211}',
  100,
  'clean_asfis_data.py:211',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_29',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8',
  NULL,
  '{"comment": "Step 5: Write final output", "line": 318}',
  100,
  'clean_asfis_data.py:318',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_pattern_detection_30',
  'pattern_detection',
  'REFERENCE',
  'ALL',
  'WoRMS_download_(\d{4}-\d{2}-\d{2})',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 43}',
  100,
  'enhanced_worms_kingdom_splitter.py:43',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_31',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  '	',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 60}',
  100,
  'enhanced_worms_kingdom_splitter.py:60',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_32',
  'field_merger',
  'REFERENCE',
  'ALL',
  '',
  NULL,
  '{"comment": "Handle problematic quotes - replace them with single quotes or remove", "line": 66}',
  100,
  'enhanced_worms_kingdom_splitter.py:66',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_33',
  'string_replace',
  'REFERENCE',
  'ALL',
  '
',
  ' ',
  '{"comment": "Handle problematic quotes - replace them with single quotes or remove", "line": 68}',
  100,
  'enhanced_worms_kingdom_splitter.py:68',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_34',
  'string_replace',
  'REFERENCE',
  'ALL',
  '',
  NULL,
  '{"comment": "Handle problematic quotes - replace them with single quotes or remove", "line": 68}',
  100,
  'enhanced_worms_kingdom_splitter.py:68',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_35',
  'string_replace',
  'REFERENCE',
  'ALL',
  '"',
  '''',
  '{"comment": "Handle problematic quotes - replace them with single quotes or remove", "line": 68}',
  100,
  'enhanced_worms_kingdom_splitter.py:68',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_36',
  'field_merger',
  'REFERENCE',
  'ALL',
  '	',
  NULL,
  '{"comment": "If we have more columns, truncate to expected count", "line": 79}',
  100,
  'enhanced_worms_kingdom_splitter.py:79',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_37',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "File encoding configuration", "line": 91}',
  100,
  'enhanced_worms_kingdom_splitter.py:91',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_38',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8',
  NULL,
  '{"comment": "File encoding configuration", "line": 92}',
  100,
  'enhanced_worms_kingdom_splitter.py:92',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_39',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  '	',
  NULL,
  '{"comment": "Normalize header to expected columns", "line": 104}',
  100,
  'enhanced_worms_kingdom_splitter.py:104',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_40',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8,errors=replace',
  NULL,
  '{"comment": "Skip header", "line": 145}',
  100,
  'enhanced_worms_kingdom_splitter.py:145',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_41',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  '	',
  NULL,
  '{"comment": "Skip header", "line": 148}',
  100,
  'enhanced_worms_kingdom_splitter.py:148',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_delimiter_detection_42',
  'delimiter_detection',
  'REFERENCE',
  'ALL',
  '	',
  NULL,
  '{"comment": "Count kingdoms", "line": 161}',
  100,
  'enhanced_worms_kingdom_splitter.py:161',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_43',
  'string_replace',
  'REFERENCE',
  'ALL',
  '.txt',
  '_spaced.txt',
  '{"comment": "Auto-extracted from legacy script", "line": 215}',
  100,
  'enhanced_worms_kingdom_splitter.py:215',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_44',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8',
  NULL,
  '{"comment": "WoRMS Partition Information for PostgreSQL\n")", "line": 258}',
  100,
  'enhanced_worms_kingdom_splitter.py:258',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_45',
  'string_replace',
  'REFERENCE',
  'ALL',
  ' ',
  '_',
  '{"comment": "Expected partitions based on kingdom values\n\n")", "line": 263}',
  100,
  'enhanced_worms_kingdom_splitter.py:263',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_46',
  'string_replace',
  'REFERENCE',
  'ALL',
  '['''', ''nan'', ''NaN'']',
  NULL,
  '{"comment": "Clean and handle empty strings", "line": 115}',
  100,
  'clean_country_profile_data.py:115',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_regex_replace_47',
  'regex_replace',
  'REFERENCE',
  'ALL',
  '\([^)]*\)',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 69}',
  100,
  'clean_asfis.py:69',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_regex_replace_48',
  'regex_replace',
  'REFERENCE',
  'ALL',
  '\s+',
  ' ',
  '{"comment": "Auto-extracted from legacy script", "line": 70}',
  100,
  'clean_asfis.py:70',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_49',
  'field_merger',
  'REFERENCE',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 77}',
  100,
  'clean_asfis.py:77',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_50',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8-sig',
  NULL,
  '{"comment": "File encoding configuration", "line": 81}',
  100,
  'clean_asfis.py:81',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_51',
  'string_replace',
  'REFERENCE',
  'ALL',
  ' ',
  '_',
  '{"comment": "Auto-extracted from legacy script", "line": 83}',
  100,
  'clean_asfis.py:83',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_encoding_strategy_52',
  'encoding_strategy',
  'REFERENCE',
  'ALL',
  'encoding=utf-8',
  NULL,
  '{"comment": "File encoding configuration", "line": 87}',
  100,
  'clean_asfis.py:87',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_53',
  'string_replace',
  'REFERENCE',
  'ALL',
  ' ',
  '_',
  '{"comment": "Clean column names (in case there are any spacing issues)", "line": 126}',
  100,
  'clean_asfis.py:126',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_54',
  'string_replace',
  'REFERENCE',
  'ALL',
  '\([^)]*\)',
  NULL,
  '{"comment": "Normalize whitespace", "line": 134}',
  100,
  'clean_asfis.py:134',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_55',
  'string_replace',
  'REFERENCE',
  'ALL',
  '\s+',
  ' ',
  '{"comment": "Normalize whitespace", "line": 136}',
  100,
  'clean_asfis.py:136',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_56',
  'field_merger',
  'REFERENCE',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Convert each word: first letter uppercase, rest lowercase", "line": 168}',
  100,
  'clean_asfis.py:168',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_field_merger_57',
  'field_merger',
  'REFERENCE',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Convert each word: first letter uppercase, rest lowercase", "line": 181}',
  100,
  'clean_asfis.py:181',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from RFMO_ALL (3 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'rfmo_all_field_merger_0',
  'field_merger',
  'RFMO',
  'ALL',
  ' ',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 13}',
  100,
  'local_clean_all.py:13',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'rfmo_all_delimiter_detection_1',
  'delimiter_detection',
  'RFMO',
  'ALL',
  '_',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 16}',
  100,
  'local_clean_all.py:16',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'rfmo_all_string_replace_2',
  'string_replace',
  'RFMO',
  'ALL',
  ' ',
  '_',
  '{"comment": "Auto-extracted from legacy script", "line": 22}',
  100,
  'local_clean_all.py:22',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Rules from UNKNOWN_ALL (16 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_regex_replace_0',
  'regex_replace',
  'UNKNOWN',
  NULL,
  '[^\w\s]',
  NULL,
  '{"comment": "Convert to lowercase and replace spaces/special chars with underscore", "line": 29}',
  100,
  'convert_country_registries.py:29',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_regex_replace_1',
  'regex_replace',
  'UNKNOWN',
  NULL,
  '\s+',
  '_',
  '{"comment": "Convert to lowercase and replace spaces/special chars with underscore", "line": 30}',
  100,
  'convert_country_registries.py:30',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_encoding_strategy_2',
  'encoding_strategy',
  'UNKNOWN',
  NULL,
  'encoding=utf-8',
  NULL,
  '{"comment": "Write all rows", "line": 18}',
  100,
  'convert_chile_simple.py:18',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_3',
  'string_replace',
  'UNKNOWN',
  NULL,
  '
',
  ' ',
  '{"comment": "Handle any type of value", "line": 28}',
  100,
  'convert_chile_simple.py:28',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_4',
  'string_replace',
  'UNKNOWN',
  NULL,
  ',',
  ';',
  '{"comment": "Handle any type of value", "line": 28}',
  100,
  'convert_chile_simple.py:28',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_field_merger_5',
  'field_merger',
  'UNKNOWN',
  NULL,
  ',',
  NULL,
  '{"comment": "Handle any type of value", "line": 29}',
  100,
  'convert_chile_simple.py:29',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_6',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_',
  NULL,
  '{"comment": "Extract region info from filename", "line": 54}',
  100,
  'convert_chile_simple.py:54',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_7',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_20',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 62}',
  100,
  'convert_chile_simple.py:62',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_8',
  'string_replace',
  'UNKNOWN',
  NULL,
  'CHL_vessels_',
  'CHILE_',
  '{"comment": "Auto-extracted from legacy script", "line": 62}',
  100,
  'convert_chile_simple.py:62',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_9',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_20',
  NULL,
  '{"comment": "Auto-extracted from legacy script", "line": 64}',
  100,
  'convert_chile_simple.py:64',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_10',
  'string_replace',
  'UNKNOWN',
  NULL,
  'CHL_vessels_',
  'CHILE_',
  '{"comment": "Auto-extracted from legacy script", "line": 64}',
  100,
  'convert_chile_simple.py:64',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_11',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_',
  NULL,
  '{"comment": "e.g., CHL_region_III_RPA_2025-09-08.xlsx → CHILE_III", "line": 83}',
  100,
  'convert_chile_to_csv.py:83',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_12',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_20',
  NULL,
  '{"comment": "Handle special cases like CHL_vessels_LTP-PEP", "line": 92}',
  100,
  'convert_chile_to_csv.py:92',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_13',
  'string_replace',
  'UNKNOWN',
  NULL,
  'CHL_vessels_',
  'CHILE_',
  '{"comment": "Handle special cases like CHL_vessels_LTP-PEP", "line": 92}',
  100,
  'convert_chile_to_csv.py:92',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_delimiter_detection_14',
  'delimiter_detection',
  'UNKNOWN',
  NULL,
  '_20',
  NULL,
  '{"comment": "Handle CHL_vessels_LTP-PEP format", "line": 95}',
  100,
  'convert_chile_to_csv.py:95',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'unknown_all_string_replace_15',
  'string_replace',
  'UNKNOWN',
  NULL,
  'CHL_vessels_',
  'CHILE_',
  '{"comment": "Handle CHL_vessels_LTP-PEP format", "line": 95}',
  100,
  'convert_chile_to_csv.py:95',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();


-- Total rules extracted: 135
-- Rule types: string_replace, field_count_mismatch, encoding_strategy, pattern_detection, field_count_too_few, regex_replace, quote_fix, delimiter_detection, field_merger, field_count_too_many
