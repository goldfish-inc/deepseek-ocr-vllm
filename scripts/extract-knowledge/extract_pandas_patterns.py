#!/usr/bin/env python3
"""
Extract cleaning patterns from legacy pandas scripts into SQL INSERT statements.

This script parses Python files using AST (Abstract Syntax Tree) analysis to extract:
- Regex patterns (re.sub, re.findall, re.search)
- String replacements (str.replace)
- Conditional logic (if statements with pattern matching)
- Inline comments explaining the fix

Outputs: seed_cleaning_rules.sql with INSERT statements for stage.cleaning_rules table

Usage:
    python extract_pandas_patterns.py \
        --input scripts/legacy-pandas-cleaners/ \
        --output sql/seed_cleaning_rules.sql
"""

import ast
import argparse
import re
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass


@dataclass
class CleaningRule:
    """Represents a single cleaning pattern extracted from a script."""
    script_name: str
    line_number: int
    rule_type: str  # regex_replace, string_replace, quote_fix, etc.
    pattern: str
    replacement: Optional[str]
    comment: Optional[str]
    source_type: str  # COUNTRY, RFMO, REFERENCE
    source_name: Optional[str]  # EU_ESP, ICCAT, etc.


class PandasPatternExtractor(ast.NodeVisitor):
    """AST visitor that extracts cleaning patterns from Python code."""

    def __init__(self, script_path: Path, source_lines: List[str]):
        self.script_path = script_path
        self.source_lines = source_lines
        self.rules: List[CleaningRule] = []

        # Determine source type and name from path
        parts = script_path.parts
        if 'country' in parts:
            self.source_type = 'COUNTRY'
            # Extract from filename: clean_esp_vessels.py → EU_ESP
            filename = script_path.stem
            if 'esp' in filename.lower():
                self.source_name = 'EU_ESP'
            elif 'dnk' in filename.lower():
                self.source_name = 'EU_DNK'
            elif 'bgr' in filename.lower():
                self.source_name = 'EU_BGR'
            else:
                self.source_name = None
        elif 'rfmo' in parts:
            self.source_type = 'RFMO'
            self.source_name = 'ALL'  # RFMO cleaner applies to all RFMOs
        elif 'reference' in parts:
            self.source_type = 'REFERENCE'
            self.source_name = 'ALL'
        else:
            self.source_type = 'UNKNOWN'
            self.source_name = None

    def get_comment_for_line(self, lineno: int, window: int = 5) -> Optional[str]:
        """Extract comment near the given line number."""
        start = max(0, lineno - window)
        end = min(len(self.source_lines), lineno + 1)

        for i in range(end - 1, start - 1, -1):
            line = self.source_lines[i]
            if '#' in line:
                comment = line.split('#', 1)[1].strip()
                # Clean up common patterns
                comment = comment.replace('Issue ', '').replace('Pattern:', '').strip()
                return comment
        return None

    def visit_Call(self, node: ast.Call):
        """Extract function calls like re.sub(), str.replace(), etc."""

        # Pattern 0: open(file, encoding='...') - Extract encoding strategies
        if (isinstance(node.func, ast.Name) and
            node.func.id == 'open'):

            encoding = None
            errors_mode = None

            for keyword in node.keywords:
                if keyword.arg == 'encoding':
                    try:
                        encoding = ast.literal_eval(keyword.value)
                    except:
                        pass
                elif keyword.arg == 'errors':
                    try:
                        errors_mode = ast.literal_eval(keyword.value)
                    except:
                        pass

            if encoding or errors_mode:
                comment = self.get_comment_for_line(node.lineno)
                pattern = f"encoding={encoding}" if encoding else ""
                if errors_mode:
                    pattern += f",errors={errors_mode}"

                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type='encoding_strategy',
                    pattern=pattern,
                    replacement=None,
                    comment=comment or 'File encoding configuration',
                    source_type=self.source_type,
                    source_name=self.source_name
                ))

        # Pattern 1: re.sub(pattern, replacement, text)
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr == 'sub' and
            isinstance(node.func.value, ast.Name) and
            node.func.value.id == 're'):

            try:
                pattern = ast.literal_eval(node.args[0])
                replacement = ast.literal_eval(node.args[1]) if len(node.args) > 1 else None
                comment = self.get_comment_for_line(node.lineno)

                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type='regex_replace',
                    pattern=pattern,
                    replacement=replacement,
                    comment=comment,
                    source_type=self.source_type,
                    source_name=self.source_name
                ))
            except (ValueError, SyntaxError):
                # Pattern uses variables, skip for now
                pass

        # Pattern 2: str.replace(old, new) or line.replace(old, new)
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr == 'replace' and
            len(node.args) >= 2):

            try:
                old_value = ast.literal_eval(node.args[0])
                new_value = ast.literal_eval(node.args[1])
                comment = self.get_comment_for_line(node.lineno)

                # Determine if this is a quote fix
                rule_type = 'string_replace'
                if '",' in old_value or '", ' in old_value:
                    rule_type = 'quote_fix'

                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type=rule_type,
                    pattern=old_value,
                    replacement=new_value,
                    comment=comment,
                    source_type=self.source_type,
                    source_name=self.source_name
                ))
            except (ValueError, SyntaxError):
                pass

        # Pattern 3: re.findall(pattern, text) - often used before replacements
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr in ('findall', 'search', 'match') and
            isinstance(node.func.value, ast.Name) and
            node.func.value.id == 're'):

            try:
                pattern = ast.literal_eval(node.args[0])
                comment = self.get_comment_for_line(node.lineno)

                # These are detection patterns, not replacements
                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type='pattern_detection',
                    pattern=pattern,
                    replacement=None,
                    comment=comment,
                    source_type=self.source_type,
                    source_name=self.source_name
                ))
            except (ValueError, SyntaxError):
                pass

        # Pattern 4: str.split() with delimiter detection
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr == 'split' and
            len(node.args) >= 1):

            try:
                delimiter = ast.literal_eval(node.args[0])
                comment = self.get_comment_for_line(node.lineno)

                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type='delimiter_detection',
                    pattern=delimiter,
                    replacement=None,
                    comment=comment,
                    source_type=self.source_type,
                    source_name=self.source_name
                ))
            except (ValueError, SyntaxError):
                pass

        # Pattern 5: str.join() with delimiter specification
        if (isinstance(node.func, ast.Attribute) and
            node.func.attr == 'join' and
            isinstance(node.func.value, ast.Constant)):

            try:
                delimiter = node.func.value.value
                comment = self.get_comment_for_line(node.lineno)

                self.rules.append(CleaningRule(
                    script_name=self.script_path.name,
                    line_number=node.lineno,
                    rule_type='field_merger',
                    pattern=delimiter,
                    replacement=None,
                    comment=comment,
                    source_type=self.source_type,
                    source_name=self.source_name
                ))
            except (ValueError, SyntaxError, AttributeError):
                pass

        self.generic_visit(node)

    def visit_Compare(self, node: ast.Compare):
        """Extract field count validation patterns."""
        # Pattern: if field_count < expected_fields:
        if (isinstance(node.left, ast.Name) and
            'field' in node.left.id.lower() and
            'count' in node.left.id.lower()):

            comment = self.get_comment_for_line(node.lineno)

            # Determine comparison type
            if any(isinstance(op, ast.Lt) for op in node.ops):
                rule_type = 'field_count_too_few'
            elif any(isinstance(op, ast.Gt) for op in node.ops):
                rule_type = 'field_count_too_many'
            elif any(isinstance(op, (ast.NotEq, ast.Eq)) for op in node.ops):
                rule_type = 'field_count_mismatch'
            else:
                rule_type = 'field_count_validation'

            self.rules.append(CleaningRule(
                script_name=self.script_path.name,
                line_number=node.lineno,
                rule_type=rule_type,
                pattern='field_count_validation',
                replacement=None,
                comment=comment or 'Field count validation logic',
                source_type=self.source_type,
                source_name=self.source_name
            ))

        self.generic_visit(node)


def extract_from_script(script_path: Path) -> List[CleaningRule]:
    """Parse a single Python script and extract all cleaning rules."""
    print(f"Extracting patterns from: {script_path.name}")

    with open(script_path, 'r', encoding='utf-8') as f:
        source = f.read()
        source_lines = source.split('\n')

    try:
        tree = ast.parse(source)
        extractor = PandasPatternExtractor(script_path, source_lines)
        extractor.visit(tree)

        print(f"  Found {len(extractor.rules)} patterns")
        return extractor.rules
    except SyntaxError as e:
        print(f"  ERROR: Failed to parse {script_path}: {e}")
        return []


def generate_sql(rules: List[CleaningRule]) -> str:
    """Generate SQL INSERT statements for all extracted rules."""

    sql_lines = [
        "-- Extracted cleaning rules from legacy pandas scripts",
        "-- Generated: 2025-09-30",
        "-- Source: scripts/legacy-pandas-cleaners/",
        "",
        "-- Create schema if not exists",
        "CREATE SCHEMA IF NOT EXISTS stage;",
        "",
        "-- Ensure cleaning_rules table exists (should be created by migration)",
        "-- See sql/migrations/001_create_staging_schema.sql",
        "",
    ]

    # Group rules by source type
    rules_by_source = {}
    for rule in rules:
        key = f"{rule.source_type}_{rule.source_name or 'ALL'}"
        if key not in rules_by_source:
            rules_by_source[key] = []
        rules_by_source[key].append(rule)

    # Generate SQL for each group
    for source_key, source_rules in sorted(rules_by_source.items()):
        sql_lines.append(f"-- Rules from {source_key} ({len(source_rules)} patterns)")
        sql_lines.append("")

        for idx, rule in enumerate(source_rules):
            # Generate unique rule name
            rule_name = f"{rule.source_type.lower()}_{rule.source_name or 'all'}_{rule.rule_type}_{idx}"
            rule_name = rule_name.replace('_', '_').lower()

            # Escape SQL strings (handle cases where pattern might be a list or complex type)
            pattern_str = str(rule.pattern) if rule.pattern else ''
            pattern_escaped = pattern_str.replace("'", "''")
            replacement_str = str(rule.replacement) if rule.replacement else ''
            replacement_escaped = replacement_str.replace("'", "''")
            comment_escaped = (rule.comment or 'Auto-extracted from legacy script').replace("'", "''")

            # Determine priority (higher = more specific)
            priority = 100
            if rule.rule_type == 'quote_fix':
                priority = 200  # Quote fixes are high priority
            if rule.source_name and rule.source_name != 'ALL':
                priority += 50  # Source-specific rules get priority boost

            sql = f"""INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  '{rule_name}',
  '{rule.rule_type}',
  '{rule.source_type}',
  {f"'{rule.source_name}'" if rule.source_name else 'NULL'},
  '{pattern_escaped}',
  {f"'{replacement_escaped}'" if rule.replacement else 'NULL'},
  '{{"comment": "{comment_escaped}", "line": {rule.line_number}}}',
  {priority},
  '{rule.script_name}:{rule.line_number}',
  TRUE
) ON CONFLICT (rule_name) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  replacement = EXCLUDED.replacement,
  updated_at = NOW();
"""
            sql_lines.append(sql)

        sql_lines.append("")

    # Summary
    total_rules = len(rules)
    sql_lines.append(f"-- Total rules extracted: {total_rules}")
    sql_lines.append(f"-- Rule types: " + ", ".join(set(r.rule_type for r in rules)))

    return '\n'.join(sql_lines)


def main():
    parser = argparse.ArgumentParser(
        description='Extract cleaning patterns from legacy pandas scripts'
    )
    parser.add_argument(
        '--input',
        type=Path,
        default=Path('scripts/legacy-pandas-cleaners'),
        help='Directory containing legacy pandas scripts'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('sql/seed_cleaning_rules.sql'),
        help='Output SQL file path'
    )
    args = parser.parse_args()

    print(f"Scanning {args.input} for Python scripts...")

    # Find all Python files
    script_files = list(args.input.rglob('*.py'))
    print(f"Found {len(script_files)} Python files\n")

    # Extract rules from each script
    all_rules = []
    for script_path in script_files:
        rules = extract_from_script(script_path)
        all_rules.extend(rules)

    print(f"\nTotal patterns extracted: {len(all_rules)}")

    # Generate SQL
    print(f"\nGenerating SQL output to: {args.output}")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    sql_content = generate_sql(all_rules)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write(sql_content)

    print(f"✓ Generated {args.output} ({len(all_rules)} rules)")

    # Print summary by rule type
    rule_types = {}
    for rule in all_rules:
        rule_types[rule.rule_type] = rule_types.get(rule.rule_type, 0) + 1

    print("\nRule type breakdown:")
    for rule_type, count in sorted(rule_types.items()):
        print(f"  {rule_type}: {count}")


if __name__ == '__main__':
    main()