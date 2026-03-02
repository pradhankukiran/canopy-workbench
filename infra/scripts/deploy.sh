#!/usr/bin/env bash
# -------------------------------------------------------------------
# deploy.sh
#
# EC2 deployment script for canopy-workbench.
# Pulls latest code, builds Docker images, and brings up the stack.
#
# Usage:
#   ./deploy.sh              # default: pull + build + up + health check
#   ./deploy.sh --no-pull    # skip git pull (useful for local testing)
# -------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.prod.yml"
API_URL="http://localhost:3001"
HEALTH_RETRIES=30
HEALTH_INTERVAL=2

SKIP_PULL=false
for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL=true ;;
  esac
done

cd "$REPO_DIR"

# ── 1. Preflight checks ───────────────────────────────────────
echo "==> Preflight checks"

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found."
  exit 1
fi

# ── 2. Pull latest code ───────────────────────────────────────
if [ "$SKIP_PULL" = false ]; then
  echo "==> Pulling latest code"
  git pull --ff-only
fi

# ── 3. Build images ───────────────────────────────────────────
echo "==> Building Docker images"
docker compose -f "$COMPOSE_FILE" build --parallel

# ── 4. Bring up services ──────────────────────────────────────
echo "==> Starting services"
docker compose -f "$COMPOSE_FILE" up -d

# ── 5. Health checks ──────────────────────────────────────────
echo "==> Waiting for API health check ($API_URL/health)"
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -sf "$API_URL/health" >/dev/null 2>&1; then
    echo "    API is healthy! (attempt $i)"
    break
  fi
  if [ "$i" -eq "$HEALTH_RETRIES" ]; then
    echo "ERROR: API failed to become healthy after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
    echo "==> Recent API logs:"
    docker compose -f "$COMPOSE_FILE" logs --tail=30 api
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
done

echo "==> Checking worker container"
if docker compose -f "$COMPOSE_FILE" exec -T worker \
  node -e "process.exit(0)" 2>/dev/null; then
  echo "    Worker container is running."
else
  echo "WARNING: Worker container may not be healthy."
  echo "==> Recent worker logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=20 worker
fi

# ── 6. Summary ────────────────────────────────────────────────
echo ""
echo "==> Deployment complete!"
echo ""
docker compose -f "$COMPOSE_FILE" ps
