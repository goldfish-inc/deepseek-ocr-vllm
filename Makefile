SHELL := /bin/bash

PARQUET ?= data/mvp/vessels_mvp.parquet
PY := python
# Allow overriding the DuckDB CLI path/version (e.g. DUCKDB=./tools/duckdb/duckdb)
DUCKDB ?= duckdb

.PHONY: parquet md.load pg.dev.up pg.dev.load pg.dev.index graphql.up cb.load.parquet cb.load.md cb.index graphql.cb supabase.load

parquet:
	@mkdir -p $(dir $(PARQUET))
	$(PY) scripts/mvp_build_dataset.py --parquet $(PARQUET)

md.load: ## Load $(PARQUET) into MotherDuck (requires MOTHERDUCK_TOKEN)
	@if [[ -z "$$MOTHERDUCK_TOKEN" ]]; then echo "MOTHERDUCK_TOKEN not set"; exit 1; fi
	$(DUCKDB) -c "INSTALL motherduck; LOAD motherduck; \
	SET motherduck_token='$$MOTHERDUCK_TOKEN'; \
	ATTACH 'md:vessels_demo' AS md (READ_ONLY false); \
	CREATE OR REPLACE TABLE md.vessels AS SELECT * FROM read_parquet('$(PARQUET)'); \
	SELECT COUNT(*) FROM md.vessels;"

pg.dev.up: ## Start local Postgres 17.6
	@if ! docker ps -a --format '{{.Names}}' | grep -q '^vessels-db$$'; then \
		docker run --name vessels-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vessels -p 5432:5432 -d postgres:17.6; \
	else \
		echo 'vessels-db already exists'; \
	fi

pg.dev.load: parquet pg.dev.up ## Load $(PARQUET) into local Postgres via DuckDB (CTAS)
	$(DUCKDB) -c "INSTALL postgres; LOAD postgres; \
	ATTACH 'pg' (TYPE POSTGRES, HOST '127.0.0.1', PORT 5432, USER 'postgres', PASSWORD 'postgres', DATABASE 'vessels'); \
	CREATE OR REPLACE TABLE pg.vessels AS SELECT * FROM read_parquet('$(PARQUET)');"

pg.dev.index: ## Add PK + indexes to local Postgres
	docker exec -i vessels-db psql -U postgres -d vessels -v ON_ERROR_STOP=1 -c "ALTER TABLE vessels ADD COLUMN IF NOT EXISTS id bigserial PRIMARY KEY;"
	docker exec -i vessels-db psql -U postgres -d vessels -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_entity_id_idx ON vessels(entity_id);"
	docker exec -i vessels-db psql -U postgres -d vessels -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_imo_idx ON vessels(imo);"
	docker exec -i vessels-db psql -U postgres -d vessels -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_mmsi_idx ON vessels(mmsi);"

graphql.up: ## Start PostGraphile on localhost:5000 against local PG
	docker run --rm -p 5000:5000 --network host graphile/postgraphile \
	  --connection postgres://postgres:postgres@localhost:5432/vessels \
	  --schema public --enhance-graphiql

supabase.load: parquet ## Load $(PARQUET) into Supabase Postgres (requires SUPABASE_PG)
	@if [[ -z "$$SUPABASE_PG" ]]; then echo "SUPABASE_PG not set"; exit 1; fi
	@$(PY) scripts/load_supabase.py $(PARQUET)

# CrunchyBridge env: CB_HOST, CB_PORT (default 5432), CB_USER, CB_PASS, CB_DB
cb.load.parquet: parquet ## Load $(PARQUET) into CrunchyBridge via DuckDB (CTAS)
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	$(DUCKDB) -c "INSTALL postgres; LOAD postgres; \
	ATTACH 'pg' (TYPE POSTGRES, HOST '$$CB_HOST', PORT $${CB_PORT:-5432}, USER '$$CB_USER', PASSWORD '$$CB_PASS', DATABASE '$$CB_DB'); \
	CREATE OR REPLACE TABLE pg.vessels AS SELECT * FROM read_parquet('$(PARQUET)');"

cb.load.md: ## Copy MotherDuck md.vessels → CrunchyBridge (requires MOTHERDUCK_TOKEN + CB_* env)
	@if [[ -z "$$MOTHERDUCK_TOKEN" ]]; then echo "MOTHERDUCK_TOKEN not set"; exit 1; fi
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	$(DUCKDB) -c "INSTALL motherduck; LOAD motherduck; SET motherduck_token='$$MOTHERDUCK_TOKEN'; ATTACH 'md:vessels_demo' AS md; \
	INSTALL postgres; LOAD postgres; ATTACH 'pg' (TYPE POSTGRES, HOST '$$CB_HOST', PORT $${CB_PORT:-5432}, USER '$$CB_USER', PASSWORD '$$CB_PASS', DATABASE '$$CB_DB'); \
	CREATE OR REPLACE TABLE pg.vessels AS SELECT * FROM md.vessels;"

cb.index: ## Add PK + indexes to CrunchyBridge vessels table (deprecated: use cb.schema)
	@echo "DEPRECATED: Use 'make cb.schema' instead for full schema setup (extensions, indexes, functions, views)"
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -c "ALTER TABLE vessels ADD COLUMN IF NOT EXISTS id bigserial PRIMARY KEY;"
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_entity_id_idx ON vessels(entity_id);"
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_imo_idx ON vessels(imo);"
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -c "CREATE INDEX IF NOT EXISTS vessels_mmsi_idx ON vessels(mmsi);"

cb.schema: ## Apply full schema (extensions, indexes, functions, views) from sql/vessels_lookup.sql
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	@if [[ ! -f sql/vessels_lookup.sql ]]; then echo "sql/vessels_lookup.sql not found"; exit 1; fi
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -f sql/vessels_lookup.sql
	@echo "Schema applied successfully (extensions, indexes, functions, views)"

cb.normalize: ## Normalize vessels column names to lowercase
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	PGPASSWORD=$$CB_PASS psql -h $$CB_HOST -p $${CB_PORT:-5432} -U $$CB_USER -d $$CB_DB -v ON_ERROR_STOP=1 -c \
	"DO \$$\$$ DECLARE r record; BEGIN FOR r IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='vessels' AND column_name <> lower(column_name) LOOP EXECUTE format('ALTER TABLE public.vessels RENAME COLUMN %I TO %I', r.column_name, lower(r.column_name)); END LOOP; END \$$\$$;"
	@echo "Column names normalized to lowercase"

cb.full: cb.load.parquet cb.normalize cb.schema ## Full pipeline: load parquet → normalize columns → apply schema
	@echo "Full Crunchy Bridge setup complete"

graphql.cb: ## Start PostGraphile against CrunchyBridge (read-only recommended)
	@if [[ -z "$$CB_HOST" || -z "$$CB_USER" || -z "$$CB_PASS" || -z "$$CB_DB" ]]; then echo "Set CB_HOST, CB_USER, CB_PASS, CB_DB (CB_PORT optional)"; exit 1; fi
	docker run --rm -p 5000:5000 graphile/postgraphile \
	  --connection postgres://$$CB_USER:$$CB_PASS@$$CB_HOST:$${CB_PORT:-5432}/$$CB_DB \
	  --schema public --enhance-graphiql
