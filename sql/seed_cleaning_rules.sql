-- Extracted cleaning rules from legacy pandas scripts
-- Generated: 2025-09-30
-- Source: scripts/legacy-pandas-cleaners/

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS stage;

-- Ensure cleaning_rules table exists (should be created by migration)
-- See sql/migrations/001_create_staging_schema.sql

-- Rules from COUNTRY_EU_BGR (3 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_quote_fix_0',
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
  'country_eu_bgr_pattern_detection_1',
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
  'country_eu_bgr_pattern_detection_2',
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


-- Rules from COUNTRY_EU_DNK (1 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_pattern_detection_0',
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


-- Rules from COUNTRY_EU_ESP (1 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_esp_quote_fix_0',
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


-- Rules from REFERENCE_ALL (12 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'reference_all_string_replace_0',
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
  'reference_all_string_replace_1',
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
  'reference_all_string_replace_2',
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
  'reference_all_string_replace_3',
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
  'reference_all_string_replace_4',
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
  'reference_all_string_replace_5',
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
  'reference_all_regex_replace_6',
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
  'reference_all_regex_replace_7',
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
  'reference_all_string_replace_8',
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
  'reference_all_string_replace_9',
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
  'reference_all_string_replace_10',
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
  'reference_all_string_replace_11',
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


-- Rules from RFMO_ALL (1 patterns)

INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'rfmo_all_string_replace_0',
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


-- Total rules extracted: 18
-- Rule types: quote_fix, string_replace, pattern_detection, regex_replace