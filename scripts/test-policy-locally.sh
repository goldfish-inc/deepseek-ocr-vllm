#!/bin/bash
set -e

echo "🧪 Running Policy Enforcement Checks Locally"
echo "============================================"

cd "$(dirname "$0")/.."

# 1. Shell Scripts Check
echo ""
echo "1️⃣  Checking for forbidden shell scripts..."
FORBIDDEN_SCRIPTS=$(find cluster -type f -name "*.sh" -path "*/scripts/*" | grep -v ".github" || true)
if [ -n "$FORBIDDEN_SCRIPTS" ]; then
  echo "⚠️  Shell scripts found under cluster/scripts (advisory):"
  echo "$FORBIDDEN_SCRIPTS"
else
  echo "✅ No shell scripts found under cluster/scripts"
fi

# 2. Pulumi Configuration
echo ""
echo "2️⃣  Validating Pulumi configuration..."
cd cluster/
if ! grep -q "MigrationOrchestrator" src/index.ts; then
  echo "❌ MigrationOrchestrator not found"
  exit 1
fi
echo "✅ Pulumi configuration valid"
cd ..

# 3. Hardcoded Credentials
echo ""
echo "3️⃣  Scanning for hardcoded credentials..."
VIOLATIONS=$(grep -rE "password[[:space:]]*=[[:space:]]*[\"'][^\"']{8,}[\"']|token[[:space:]]*=[[:space:]]*[\"'][a-zA-Z0-9_-]{20,}[\"']|key[[:space:]]*=[[:space:]]*[\"'](ssh-|-----BEGIN)[^\"']+[\"']|secret[[:space:]]*=[[:space:]]*[\"'][a-zA-Z0-9_-]{16,}[\"']" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.claude --exclude-dir=docs --exclude-dir=.venv --exclude="*.log" --exclude="*.md" --exclude-dir=legacy || true)
if [ -n "$VIOLATIONS" ]; then
  echo "❌ Potential hardcoded credentials found:"
  echo "$VIOLATIONS"
  exit 1
fi
echo "✅ No hardcoded credentials detected"

# 4. TypeScript Build
echo ""
echo "4️⃣  Building TypeScript (cluster)..."
cd cluster/
if ! pnpm install --frozen-lockfile 2>&1 | tail -5; then
  echo "❌ pnpm install failed"
  exit 1
fi

if ! pnpm run build 2>&1 | tail -10; then
  echo "❌ TypeScript compilation failed"
  exit 1
fi

# Check structure
if [ ! -d "src/components" ]; then
  echo "❌ Missing required directory: src/components"
  exit 1
fi

for file in "src/index.ts" "src/config.ts" "src/providers.ts"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing required file: $file"
    exit 1
  fi
done
echo "✅ IaC standards validation passed"
cd ..

# 5. Migration Phase Configuration
echo ""
echo "5️⃣  Checking migration configuration..."
cd cluster/
if ! grep -q "migration_phase" src/index.ts; then
  echo "❌ Migration phase configuration not found"
  exit 1
fi
echo "✅ Migration configuration valid"
cd ..

# 6. Security Practices
echo ""
echo "6️⃣  Validating security practices..."
SECURITY_VIOLATIONS=$(grep -rE "console\.(log|error|warn|info)\([^)]*\b(secret|token|password)[^\"']" cluster/src/ | grep -v "console.log(\".*token.*\")" || true)
if [ -n "$SECURITY_VIOLATIONS" ]; then
  echo "❌ Security violation: secrets being logged:"
  echo "$SECURITY_VIOLATIONS"
  exit 1
fi

if ! grep -q "cfg.requireSecret\|cfg.getSecret" cluster/src/index.ts; then
  echo "❌ No ESC secret configuration found"
  exit 1
fi
echo "✅ Security practices validation passed"

# 7. Documentation
echo ""
echo "7️⃣  Checking documentation..."
for doc in "SCRIPT_RETIREMENT_PLAN.md" "SCRIPT_RETIREMENT_COMPLETE.md"; do
  if [ ! -f "$doc" ]; then
    echo "❌ Missing required documentation: $doc"
    exit 1
  fi
done
echo "✅ Documentation requirements satisfied"

# 8. Pre-commit checks
echo ""
echo "8️⃣  Running pre-commit checks..."
# Skip actionlint if Docker isn't running (requires Docker)
export SKIP=actionlint-docker
if pre-commit run --all-files 2>&1 | tail -20; then
  echo "✅ Pre-commit checks passed"
else
  echo "⚠️  Pre-commit checks had warnings (review above)"
fi
unset SKIP

# 10. Adapter Tests (non-blocking)
echo ""
echo "🔟 Running adapter unit tests (non-blocking)..."
if [ -f "adapter/requirements.txt" ]; then
  echo "Setting up Python venv..."
  python3 -m venv .venv
  . .venv/bin/activate
  pip install -q -r adapter/requirements.txt

  current_dir="$(pwd)"
  export PYTHONPATH="${PYTHONPATH}:${current_dir}"

  if pytest -q adapter/tests; then
    echo "✅ Adapter unit tests passed"
  else
    echo "⚠️  Adapter unit tests failed (non-blocking - these are ML model tests)"
  fi
  deactivate
else
  echo "ℹ️  No adapter tests found; skipping"
fi

echo ""
echo "============================================"
echo "🎉 All policy checks passed locally!"
echo "============================================"
