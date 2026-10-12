#!/usr/bin/env bash
# Read-only installation diagnostics. Never displays secrets.
set -u
export PATH="$HOME/.local/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"
missing=0
test_bin() {
  if command -v "$2" >/dev/null 2>&1; then
    printf '[OK] %s\n' "$1"
  else
    printf '[MISSING] %s\n' "$1"
    missing=$((missing + 1))
  fi
}
printf 'LFO Codespaces toolkit diagnostic\n'
printf 'Branch: %s\n' "$(git branch --show-current)"
test_bin "Node.js" node
test_bin "npm" npm
test_bin "Claude Code" claude
test_bin "uv" uv
test_bin "Graphify" graphify
test_bin "OmniRoute (installed but NOT routed)" omniroute
if command -v claude >/dev/null 2>&1; then
  printf '\nClaude plugins (expect agent-skills@addy-agent-skills + ponytail@ponytail):\n'
  claude plugin list || printf '[WARNING] Plugin listing failed.\n'
fi
if [ -d node_modules ]; then
  printf '[OK] npm dependencies\n'
else
  printf '[MISSING] npm dependencies\n'
  missing=$((missing + 1))
fi
printf 'Missing binaries/deps: %s (plugins must be checked above separately).\n' "$missing"
printf 'No secrets, migrations or remote database checks performed.\n'
if [ "$missing" -ne 0 ]; then exit 1; fi
