#!/usr/bin/env bash
# Read-only diagnostic; no access to secrets or production services.
set -u
export PATH="$HOME/.local/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"
missing=0
check() {
  if command -v "$2" >/dev/null 2>&1; then
    printf '[OK] %s\n' "$1"
  else
    printf '[MISSING] %s\n' "$1"
    missing=$((missing + 1))
  fi
}
printf 'LFO Codespaces toolkit diagnostic\n'
printf 'Branch: %s\n' "$(git branch --show-current)"
check "Node.js" node
check "npm" npm
check "Claude Code" claude
check "uv" uv
check "Graphify" graphify
check "OmniRoute (installed but NOT routed)" omniroute

if command -v claude >/dev/null 2>&1; then
  printf '\nClaude Code plugins:\n'
  if plugin_output="$(claude plugin list 2>&1)"; then
    printf '%s\n' "$plugin_output"
    for id in "agent-skills@addy-agent-skills" "ponytail@ponytail"; do
      if [[ "$plugin_output" == *"$id"* ]]; then
        printf '[OK] %s\n' "$id"
      else
        printf '[MISSING] %s\n' "$id"
        missing=$((missing + 1))
      fi
    done
  else
    printf '[MISSING] Plugin listing failed\n'
    missing=$((missing + 1))
  fi
fi

if [ -d node_modules ]; then
  printf '[OK] npm dependencies\n'
else
  printf '[MISSING] npm dependencies\n'
  missing=$((missing + 1))
fi
printf '\nMissing tools/plugins/dependencies: %s\n' "$missing"
printf 'No secrets, migrations, servers, routing or remote database checks performed.\n'
if [ "$missing" -ne 0 ]; then exit 1; fi
