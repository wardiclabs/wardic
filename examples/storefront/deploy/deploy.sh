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
# The Caddyfile as the server has it now, to tell whether this deploy changes it (below).
caddyfile_was="$(ssh "$HOST" 'md5sum wardic/examples/storefront/deploy/Caddyfile 2>/dev/null' | cut -c1-32)"
# What .dockerignore leaves out stays here, and --delete never touches it (the server's .env).
rsync -az --delete --exclude-from=.dockerignore ./ "$HOST:wardic/"
# A changed Caddyfile recreates Caddy: the file is bind-mounted into its container on its own, and rsync
# replaces a file by writing a new one and renaming it over the old, which the mount doesn't follow, so
# the container keeps reading the old file, and `caddy reload` finds its config unchanged (#795's
# Foldkit host stayed unserved after its deploy). A recreate mounts the new file; the certificates live
# in a volume, so none is lost.
ssh "$HOST" "cd wardic/examples/storefront/deploy && docker compose --profile build build image && docker compose up -d --remove-orphans && if [ \"\$(md5sum Caddyfile | cut -c1-32)\" != \"$caddyfile_was\" ]; then docker compose up -d --force-recreate --no-deps caddy; fi && docker image prune -f"
