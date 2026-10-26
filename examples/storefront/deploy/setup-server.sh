#!/usr/bin/env bash
# The storefront VPS's one-time setup (#366), as root, on Ubuntu 24.04: safe to run again.
#   ssh root@<server> 'bash -s' < setup-server.sh <domain>
# It leaves SSH as it is: lock-ssh.sh turns off passwords and root's login, once you've checked
# that `ssh deploy@<server>` lets you in.
set -euo pipefail
DOMAIN="${1:?usage: setup-server.sh <domain>}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get upgrade -yq
apt-get install -yq ufw unattended-upgrades rsync curl ca-certificates

# Docker: Hostinger's Docker template has it; otherwise, Docker's own install.
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# The deploy user: the keys root has (yours, and the deploy key), Docker, and sudo. It has no
# password, so its sudo asks for none; its keys are the way in.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG sudo,docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# Ending in a newline, so a key appended later gets a line of its own (Hostinger writes root's without one).
sed -e '$a\' /root/.ssh/authorized_keys > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

# 2 GB of swap: room for a build beside the running apps.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Only SSH, HTTP and HTTPS (HTTP/3 too). Docker publishes only Caddy's ports.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Security updates, by themselves.
dpkg-reconfigure -f noninteractive unattended-upgrades

# The app's place, and the domain it serves (deploys never overwrite .env).
install -d -o deploy -g deploy /home/deploy/wardic /home/deploy/wardic/examples /home/deploy/wardic/examples/storefront /home/deploy/wardic/examples/storefront/deploy
echo "STOREFRONT_DOMAIN=$DOMAIN" > /home/deploy/wardic/examples/storefront/deploy/.env
chown deploy:deploy /home/deploy/wardic/examples/storefront/deploy/.env

# A nightly restart: the store keeps each visitor's cart and settings in memory, unbounded.
( crontab -u deploy -l 2>/dev/null | grep -v storefront-nightly || true
  echo "30 4 * * * cd /home/deploy/wardic/examples/storefront/deploy && docker compose restart solid1 solid2 next # storefront-nightly"
) | crontab -u deploy -

echo "Set up for $DOMAIN. Check 'ssh deploy@<server>' works with your own key, then run lock-ssh.sh."
