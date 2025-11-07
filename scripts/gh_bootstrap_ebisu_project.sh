#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a GitHub Project and issues for EBISU. Requires gh CLI authenticated.

ORG_REPO=${1:-"goldfish-inc/oceanid"}
PROJECT_NAME=${2:-"EBISU Normalization & History"}

echo "Creating project: $PROJECT_NAME in $ORG_REPO"
PROJECT_ID=$(gh project create --title "$PROJECT_NAME" --format=json | jq -r '.id')
echo "Project ID: $PROJECT_ID"

echo "Creating labels"
gh label create ebisu -c "#0366d6" -d "EBISU schema/ETL" -R "$ORG_REPO" || true
gh label create etl -c "#d93f0b" -d "ETL/ingestion" -R "$ORG_REPO" || true
gh label create schema -c "#0e8a16" -d "Database schema" -R "$ORG_REPO" || true
gh label create graphql -c "#fbca04" -d "GraphQL/PostGraphile" -R "$ORG_REPO" || true
gh label create ops -c "#5319e7" -d "Operations/infra" -R "$ORG_REPO" || true
gh label create quality -c "#1d76db" -d "Data quality/validation" -R "$ORG_REPO" || true

echo "Creating issues"
create_issue() {
  local title=$1
  local body=$2
  local labels=$3
  gh issue create -R "$ORG_REPO" -t "$title" -b "$body" -l "$labels"
}

create_issue "M1: Define stage schema + batch tracking" "See docs/projects/EBISU_PROJECT.md#1-define-stage-schema--batch-tracking-m1" "ebisu,etl,schema"
create_issue "M1: EBISU vessel domain tables in Drizzle" "Extend sql/oceanid-ebisu-schema; generate migrations; see docs/projects/EBISU_PROJECT.md#2-ebisu-vessel-domain-tables-in-drizzle-m1" "ebisu,schema"
create_issue "M2: SQL transform — process_vessel_load(batch_id)" "Implement SCD-2 and audit; see docs/projects/EBISU_PROJECT.md#3-sql-transform--process_vessel_loadbatch_id-m2" "ebisu,etl"
create_issue "M2: Loader to stage (batch-aware)" "Add --stage and cb.ebisu.full; see docs/projects/EBISU_PROJECT.md#4-loader-to-stage-batch-aware-m2" "etl,ebisu"
create_issue "M3: EBISU UI views & GraphQL helpers" "Repoint vessels_lookup.sql to ebisu.*; see docs/projects/EBISU_PROJECT.md#5-ebisu-ui-views--graphql-helpers-m3" "graphql,ebisu"
create_issue "M3: PostGraphile expose ebisu schema" "Expose ['public','ebisu'] in server.js; see docs/projects/EBISU_PROJECT.md#6-postgraphile-expose-ebisu-schema-m3" "graphql,ops"
create_issue "M4: WAF / Rate limit for /graphql" "Cloudflare rule; see docs/projects/EBISU_PROJECT.md#7-waf--rate-limit-for-graphql-m4" "security,ops"
create_issue "M5: Tunnel observability + alert" "ServiceMonitor, alert; see docs/projects/EBISU_PROJECT.md#8-tunnel-observability--alert-m5" "observability,ops"
create_issue "M6: Data quality gates" "SQL assertions, CI; see docs/projects/EBISU_PROJECT.md#9-data-quality-gates-m6" "quality,ebisu"
create_issue "M5: SLOs for GraphQL" "Define & dashboard; see docs/projects/EBISU_PROJECT.md#10-slos-for-graphql-m5" "observability"
create_issue "M7: GH Action – Reload EBISU" "Manual dispatch pipeline; see docs/projects/EBISU_PROJECT.md#11-dx-gh-action-reload-ebisu-m7" "ops,etl"
create_issue "M6: Data dictionary & lineage" "Author dictionary; see docs/projects/EBISU_PROJECT.md#12-governance-data-dictionary--lineage-m6" "ebisu,quality"

echo "Add issues to project (requires manual add or GraphQL gh api)."
echo "Done."
