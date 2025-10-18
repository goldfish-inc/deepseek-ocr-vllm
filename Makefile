# Simple task runner for the Oceanid workspace

.PHONY: install build lint test preview up destroy refresh clean hooks format pre-commit

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

pre-commit:
	@command -v pre-commit >/dev/null 2>&1 || { echo "Installing pre-commit..."; python3 -m pip install --user pre-commit || pipx install pre-commit; }
	pre-commit install
	@echo "pre-commit installed. Hooks configured from .pre-commit-config.yaml"


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

# NER training + ONNX export smoke
.PHONY: smoke-ner
smoke-ner:
	bash scripts/smoke_ner.sh

# Spark NER preproc (CPU local submit)
.PHONY: spark-preproc
spark-preproc:
	@if ! command -v spark-submit >/dev/null 2>&1; then \
		echo "spark-submit not found; install Apache Spark or run on your Spark node"; exit 1; \
	fi
	@if [ -z "$(INPUT)" ] || [ -z "$(OUTPUT)" ]; then \
		echo "Usage: make spark-preproc INPUT=<path.jsonl> OUTPUT=</tmp/out>"; exit 1; \
	fi
	spark-submit --master local[*] \
	  apps/spark-jobs/ner-preproc/job.py \
	  --input "$(INPUT)" \
	  --output "$(OUTPUT)"

# Spark NER inference via adapter (per-row HTTP, simple scaffold)
.PHONY: spark-infer
spark-infer:
	@if ! command -v spark-submit >/dev/null 2>&1; then \
		echo "spark-submit not found; install Apache Spark or run on your Spark node"; exit 1; \
	fi
	@if [ -z "$(INPUT)" ] || [ -z "$(OUTPUT)" ]; then \
		echo "Usage: make spark-infer INPUT=</tmp/preproc> OUTPUT=</tmp/infer> [ADAPTER_URL=http://ls-triton-adapter.apps.svc.cluster.local:9090] [STRUCTURED=true]"; exit 1; \
	fi
	spark-submit --master local[*] \
	  apps/spark-jobs/ner-inference/job.py \
	  --input "$(INPUT)" \
	  --output "$(OUTPUT)" \
	  --adapter-url "$(ADAPTER_URL)" \
	  $(if $(STRUCTURED),--structured-output,)

# Spark NER batch inference via Triton (micro-batched, GPU-optimized)
.PHONY: spark-infer-batch
spark-infer-batch:
	@if ! command -v spark-submit >/dev/null 2>&1; then \
		echo "spark-submit not found; install Apache Spark or run on your Spark node"; exit 1; \
	fi
	@if [ -z "$(INPUT)" ] || [ -z "$(OUTPUT)" ]; then \
		echo "Usage: make spark-infer-batch INPUT=</tmp/preproc> OUTPUT=</tmp/infer-batch> [TRITON_URL=http://calypso.tail4a0e5.ts.net:8000] [MODEL_PATH=./models/ner-distilbert] [BATCH_SIZE=8]"; exit 1; \
	fi
	TOKENIZERS_PARALLELISM=false spark-submit --master local[*] \
	  apps/spark-jobs/ner-inference/job.py \
	  --batch-mode \
	  --input "$(INPUT)" \
	  --output "$(OUTPUT)" \
	  --triton-url "$(TRITON_URL)" \
	  --model-path "$(MODEL_PATH)" \
	  --batch-size "$(BATCH_SIZE)"

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

# Restart the LS adapter to pick up label changes
.PHONY: ner:adapter-restart ner:labels-apply

ner:adapter-restart:
	@command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required"; exit 1; }
	kubectl -n apps rollout restart deploy/ls-triton-adapter
	kubectl -n apps rollout status deploy/ls-triton-adapter --timeout=180s

# Full workflow: sync labels to Pulumi + restart adapter
ner:labels-apply: ner:labels-sync ner:adapter-restart
	@echo "✅ NER labels synced and adapter restarted"
