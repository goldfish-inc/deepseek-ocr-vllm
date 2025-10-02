# Simple task runner for the Oceanid workspace

.PHONY: install build lint test preview up destroy refresh clean hooks format

STACK ?= ryan-taylor/oceanid-cluster/prod

install:
	pnpm install --frozen-lockfile

build:
	pnpm --filter @oceanid/cluster build

lint:
	pnpm --filter @oceanid/cluster lint
	pnpm --filter @oceanid/policy lint

test:
	# Requires opa in PATH
	pnpm --filter @oceanid/policy test

format:
	pnpm --filter @oceanid/policy fmt

preview:
	cd cluster && pulumi stack select $(STACK) && pulumi preview --diff

up:
	cd cluster && pulumi stack select $(STACK) && pulumi up

destroy:
	cd cluster && pulumi stack select $(STACK) && pulumi destroy --yes

refresh:
	cd cluster && pulumi stack select $(STACK) && pulumi refresh --yes

clean:
	pnpm --filter @oceanid/cluster clean || true
	rm -rf cluster/bin

# Configure local Git to use repo hooks
hooks:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit
	@echo "Git hooks installed. Next commit will run type/checks and OPA tests."


# Minimal deploy for current architecture (no SSH provisioning or LB)
.PHONY: deploy-simple
deploy-simple:
	cd cluster && \
	pulumi stack select $(STACK) && \
	pulumi config set oceanid-cluster:enableNodeProvisioning false && \
	pulumi config set oceanid-cluster:enableMigration false && \
	pulumi config set oceanid-cluster:enableControlPlaneLB false && \
	pulumi config set oceanid-cluster:enableCalypsoHostConnector false && \
	pnpm --silent >/dev/null || true && \
	pulumi up --yes

.PHONY: deploy-calypso
deploy-calypso:
	cd cluster && \
	pulumi stack select $(STACK) && \
	pulumi config set oceanid-cluster:enableCalypsoHostConnector true && \
	pulumi up --yes --target-dependents \
	  --target urn:pulumi:prod::oceanid-cluster::oceanid:networking:HostCloudflared::calypso-connector \
	  --target urn:pulumi:prod::oceanid-cluster::oceanid:compute:HostDockerService::calypso-triton

.PHONY: smoke
smoke:
	bash scripts/smoke.sh

# Database (CrunchyBridge or any Postgres)
.PHONY: db:migrate db:psql db:status

MIG_DIR ?= sql/migrations
DB_URL ?= $(DATABASE_URL)

db:migrate:
	@if [ -z "$(DB_URL)" ]; then echo "Set DB_URL or DATABASE_URL to your Postgres URI"; exit 1; fi
	@command -v psql >/dev/null 2>&1 || { echo "psql is required"; exit 1; }
	@for f in $(MIG_DIR)/*.sql; do \
		echo "==> applying $$f"; \
		psql "$(DB_URL)" -v ON_ERROR_STOP=1 -f "$$f"; \
	done

db:psql:
	@if [ -z "$(DB_URL)" ]; then echo "Set DB_URL or DATABASE_URL to your Postgres URI"; exit 1; fi
	psql "$(DB_URL)"

db:status:
	@if [ -z "$(DB_URL)" ]; then echo "Set DB_URL or DATABASE_URL to your Postgres URI"; exit 1; fi
	psql "$(DB_URL)" -c "select now() as connected_at, current_user, current_database();" -c "select * from control.schema_versions order by applied_at desc limit 10;" || true

# NER training helpers (requires Python with transformers & datasets)
.PHONY: ner:train ner:export

NER_LABELS ?= labels.json
NER_DATA_DIR ?= ./local_annotations
NER_OUT ?= ./models/ner-distilbert

ner:train:
	python3 scripts/ner_train.py --labels $(NER_LABELS) --data-dir $(NER_DATA_DIR) --out $(NER_OUT)

ner:export:
	bash scripts/export_onnx.sh $(NER_OUT) distilbert_onnx 63

# NER labels config helpers
.PHONY: ner:labels-array ner:labels-sync

ner:labels-array:
	@command -v python3 >/dev/null 2>&1 || { echo "python3 is required"; exit 1; }
	python3 scripts/ner_labels_from_labels_json.py > ner_labels.json
	@echo "Wrote ner_labels.json (ordered label names)"

ner:labels-sync: ner:labels-array
	@cd cluster && pulumi stack select $(STACK)
	@pulumi -C cluster config set oceanid-cluster:nerLabels "$(shell cat ner_labels.json)" --secret
	@echo "Updated oceanid-cluster:nerLabels from ner_labels.json"
