#!/usr/bin/env bash
# Deploys the storefront demo (#366) from this checkout: copies the source to the VPS (the repo is
# private, so the server has no git access of its own), builds the image there, and restarts what
# changed. STOREFRONT_HOST names the server's SSH host (default: storefront-deploy, an ~/.ssh/config
# entry for the deploy user).
set -euo pipefail
HOST="${STOREFRONT_HOST:-storefront-deploy}"
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: the checkout has uncommitted changes: commit or stash them first" >&2
  exit 1
fi
echo "deploy: $(git log -1 --format='%h %s') to $HOST"
# What .dockerignore leaves out stays here, and --delete never touches it (the server's .env).
rsync -az --delete --exclude-from=.dockerignore ./ "$HOST:wardic/"
ssh "$HOST" 'cd wardic/examples/storefront/deploy && docker compose --profile build build image && docker compose up -d --remove-orphans && docker image prune -f'
