#!/usr/bin/env bash
# Do project rules reach a SUBAGENT's context?
#
# Two confounds this design removes:
#
# 1. LOOKUP. Asking "what is the canary value" can be answered by grepping the
#    rule file off disk, which proves nothing about context. So the canary is a
#    BEHAVIOUR ("end every reply with this token") attached to an unrelated
#    question. An agent that merely reads the file while answering something
#    else has no reason to comply.
# 2. RELAY. The parent has the same rules, so its final text is contaminated.
#    We read the Task tool_result — the subagent's own raw output.
#
# The control keeps the rule file on disk and hides it from context with
# claudeMdExcludes, so only loading differs between runs.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN="HAL-END-4T7"
MODEL="${MODEL:-haiku}"
AGENT="${AGENT:-general-purpose}"
# "wait for it" matters: an async Task returns launch metadata instead of the
# subagent's reply, and the probe then reads a false negative.
PROMPT="Use the Task tool to launch exactly one subagent with subagent_type '$AGENT'. Run it synchronously and WAIT for its result — do not run it in the background. The subagent's entire task is: 'Reply with the single word: ready'. Then say done."

[ -f "$REPO/dist/cli.mjs" ] || { echo "run pnpm build first"; exit 1; }

DIR="$(mktemp -d /tmp/hal-subagent-XXXXXX)"
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
git init -q
mkdir -p rules/canary .claude
cat > rules/canary/suffix.md <<EOF
# Reply suffix

End every reply with the exact token $TOKEN on its own line, after everything else.
EOF
printf '{ "rulesDir": ["rules"], "rules": { "canary/suffix": "on" } }\n' > hal-rules.json
node "$REPO/dist/cli.mjs" | sed 's/^/    /'

run() {
  if [ "$1" = excluded ]; then
    printf '{ "claudeMdExcludes": ["**/.claude/rules/**"] }\n' > .claude/settings.json
  else
    printf '{}\n' > .claude/settings.json
  fi
  claude -p "$PROMPT" --model "$MODEL" --output-format stream-json --verbose \
    </dev/null 2>/dev/null > stream.jsonl || true
}

# The subagent's own output, not the parent's relay of it.
inspect() {
  python3 - "$1" "$TOKEN" <<'PY'
import json, sys
path, token = sys.argv[1], sys.argv[2]
delegated = False
results = []
for line in open(path, errors="replace"):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        event = json.loads(line)
    except ValueError:
        continue
    for block in (event.get("message") or {}).get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_use" and block.get("name") in ("Task", "Agent"):
            delegated = True
        if block.get("type") == "tool_result":
            content = block.get("content")
            if isinstance(content, list):
                content = " ".join(
                    c.get("text", "") for c in content if isinstance(c, dict)
                )
            results.append(str(content or ""))
joined = " ".join(results)
print("DELEGATED" if delegated else "NO_TASK_CALL")
print("TOKEN" if token in joined else "NO_TOKEN")
print(joined.replace("\n", " ")[:140] or "(no tool_result captured)")
PY
}

report() {
  run "$1"
  local out; out="$(inspect stream.jsonl)"
  echo "  delegation:       $(sed -n 1p <<<"$out")"
  echo "  token in subagent: $(sed -n 2p <<<"$out")"
  echo "  raw:              $(sed -n 3p <<<"$out")"
  sed -n 1p <<<"$out" > .d; sed -n 2p <<<"$out" > .t
}

echo "project: $DIR"
echo; echo "== rules loaded (agent: $AGENT) =="; report loaded
ON_D="$(cat .d)"; ON_T="$(cat .t)"
echo; echo "== rules on disk but excluded from context (control) =="; report excluded
OFF_D="$(cat .d)"; OFF_T="$(cat .t)"

echo
[[ "$ON_D" != DELEGATED || "$OFF_D" != DELEGATED ]] && {
  echo "INCONCLUSIVE — a run did not delegate; nothing was tested."; exit 2; }
# Explore and Plan are documented to skip rules, so for them NOT obeying is the
# pass condition. Everything else is expected to inherit.
if [[ "$AGENT" == Explore || "$AGENT" == Plan ]]; then
  [[ "$ON_T" == NO_TOKEN ]] && {
    echo "PASS — $AGENT did not receive the rule, matching the documented exception."
    exit 0; }
  echo "UNEXPECTED — $AGENT obeyed the rule. The docs say it skips them."
  exit 1
fi

[[ "$ON_T" == TOKEN && "$OFF_T" == NO_TOKEN ]] && {
  echo "PASS — the $AGENT subagent had the rule in context and obeyed it;"
  echo "       with the same file on disk but excluded, it did not."; exit 0; }
[[ "$ON_T" == NO_TOKEN ]] && echo "FAIL — $AGENT did not obey the rule: it was not in its context."
[[ "$OFF_T" == TOKEN ]] && echo "FAIL — obeyed it even when excluded; the probe is invalid."
exit 1
