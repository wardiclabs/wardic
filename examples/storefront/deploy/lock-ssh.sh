#!/usr/bin/env bash
# No passwords and no root login over SSH (#366), once `ssh deploy@<server>` works with your key:
#   ssh deploy@<server> 'sudo bash -s' < lock-ssh.sh
# A file early in sshd_config.d, as sshd takes the first value it reads for a setting, and Ubuntu's
# cloud image ships 50-cloud-init.conf, which allows passwords.
set -euo pipefail
cat > /etc/ssh/sshd_config.d/00-storefront.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
sshd -t
systemctl reload ssh
sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
