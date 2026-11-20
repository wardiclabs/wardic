#!/usr/bin/env bash
# The release workflow's plan (#559, #566): whether a push to `main` publishes, or has changesets
# waiting for the "Version Packages" PR. Printed as `$GITHUB_OUTPUT` lines:
#
#   publishes=true|false   true when no changeset waits: the version PR has just merged
#   private=<ids>          changesets naming only private packages a version step leaves alone
#
# A changeset waits when a version step would use it up: one that names a package Changesets
# versions, or an empty one. One that names only private packages, while `privatePackages.version`
# is false (Foldkit's were, until 1.2, ADR-0071), stays on disk through every version step, so counting it
# would keep the workflow out of publishing for good (#566). In pre mode, a changeset a version step
# has used stays on disk too, listed in pre.json's `changesets`, so it doesn't wait.
#
#   scripts/changesets-waiting.sh >> "$GITHUB_OUTPUT"
set -euo pipefail
cd "$(dirname "$0")/.."

used=""
if [ -f .changeset/pre.json ] && [ "$(jq -r .mode .changeset/pre.json)" = pre ]; then
  used=$(jq -r '.changesets[]' .changeset/pre.json)
fi

# The private packages a version step leaves alone: none unless `privatePackages.version` is false
# (Changesets' default is true). Not `// true`: jq's `//` takes false for missing.
unversioned=""
if [ "$(jq -r 'if .privatePackages.version == false then "no" else "yes" end' .changeset/config.json)" = no ]; then
  unversioned=$(git ls-files -- 'package.json' '*/package.json' | xargs jq -r 'select(.private == true and .name != null) | .name')
fi

waiting=0
private=()
for file in .changeset/*.md; do
  id=$(basename "$file" .md)
  if [ "$id" = README ] || grep -qxF "$id" <<<"$used"; then continue; fi
  # The packages its front matter names, one per line: `"@wardic/dom": patch`, quoted or not.
  names=$(awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside { print }' "$file" |
    sed -nE 's/^"?([^":]+)"?[[:space:]]*:.*/\1/p')
  if [ -n "$names" ] && [ -n "$unversioned" ] && ! grep -qvxF -f <(printf '%s\n' "$unversioned") <<<"$names"; then
    private+=("$id")
  else
    waiting=$((waiting + 1))
  fi
done

publishes=false
if [ "$waiting" -eq 0 ]; then publishes=true; fi
echo "changesets waiting: $waiting; private-only, left for their package's release: ${private[*]:-none}" >&2
echo "publishes=$publishes"
echo "private=${private[*]}"
