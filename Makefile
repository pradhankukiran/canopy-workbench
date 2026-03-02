.PHONY: help setup dev dev-up dev-down dev-logs dev-ps dev-web dev-api dev-worker lint test build ci smoke-e2e

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "%-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST) | sort

setup: ## Create .env from .env.example if missing
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; else echo ".env already exists"; fi

dev: dev-up ## Start local development infrastructure

dev-up: ## Start postgres, redis, and minio in the background
	docker compose up -d postgres redis minio

dev-down: ## Stop and remove local development infrastructure
	docker compose down

dev-logs: ## Tail logs for local development infrastructure
	docker compose logs -f --tail=200 postgres redis minio

dev-ps: ## Show local infrastructure container status
	docker compose ps

dev-web: ## Run the frontend shell (requires pnpm install)
	pnpm --filter @canopy/web dev

dev-api: ## Run the API service (requires Redis reachable at REDIS_URL)
	pnpm --filter @canopy/api dev

dev-worker: ## Run the async worker (requires Redis reachable at REDIS_URL)
	pnpm --filter @canopy/worker dev

lint: ## Placeholder lint target for Phase 0
	@echo "TODO: wire lint commands for apps/services/scala modules"

test: ## Placeholder test target for Phase 0
	@echo "TODO: wire test commands for repo components"

build: ## Placeholder build target for Phase 0
	@echo "TODO: wire build commands for deployable components"

ci: ## Run local CI placeholder pipeline
	$(MAKE) lint
	$(MAKE) test
	$(MAKE) build

smoke-e2e: ## Run API+worker queue smoke (requires Docker daemon)
	bash ./scripts/smoke_e2e_worker_api.sh
