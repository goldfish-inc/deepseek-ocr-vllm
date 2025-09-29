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
