#!/usr/bin/env bash
# Does a generated rule actually reach a real Claude Code session?
#
# Builds a throwaway project, generates ONE rule whose entire content is
# "emit this token", then launches a real session there and greps for it.
# The control run (same prompt, rule off) is what makes a pass mean anything.
#
# This verifies LOADING, not adherence. A rule like never-push needs a tempting
# prompt and a human reading the answer — see docs/verifying-a-change.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANARY="HAL-CANARY-7Q2X"
PROBE="Reply with exactly the single word: ready"
MODEL="${MODEL:-haiku}"

[ -f "$REPO/dist/cli.mjs" ] || { echo "run pnpm build first"; exit 1; }

DIR="$(mktemp -d /tmp/hal-verify-XXXXXX)"
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
git init -q
mkdir -p rules/canary
cat > rules/canary/prefix.md <<EOF
# Canary

Begin every reply with the exact token $CANARY on its own line, before anything else.
EOF

generate() {
  printf '{ "rulesDir": ["rules"], "rules": { "canary/prefix": "%s" } }\n' "$1" > hal-rules.json
  node "$REPO/dist/cli.mjs" | sed 's/^/    /'
}

# < /dev/null: without it the CLI waits 3s for piped stdin and warns.
probe() { claude -p "$PROBE" --model "$MODEL" </dev/null 2>&1 || true; }

echo "project: $DIR"
echo
echo "== rule ON =="
generate on
ON="$(probe)"
echo "  reply: ${ON//$'\n'/ | }"

echo
echo "== rule OFF (control) =="
generate off
OFF="$(probe)"
echo "  reply: ${OFF//$'\n'/ | }"

echo
if [[ "$ON" == *"$CANARY"* && "$OFF" != *"$CANARY"* ]]; then
  echo "PASS — the rule loaded and changed the output; with it off, it did not."
  exit 0
fi
[[ "$ON" != *"$CANARY"* ]] && echo "FAIL — rule ON did not emit the canary: the rule never reached the session."
[[ "$OFF" == *"$CANARY"* ]] && echo "FAIL — rule OFF still emitted it: the canary proves nothing."
exit 1
