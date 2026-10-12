#!/usr/bin/env bash
# This bootstrap only installs development tools. Never accesses Supabase.
set -Eeuo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"
failures=0
step() {
  local label="$1"
  shift
  printf '\n==> %s\n' "$label"
  if "$@"; then
    printf '[OK] %s\n' "$label"
  else
    printf '[FAILED] %s -- inspect output and rerun bootstrap\n' "$label" >&2
    failures=$((failures + 1))
  fi
}
printf 'LFO cloud tooling: no production access, no migration and no route activation.\n'
step "Versions Node/npm" bash -c 'node --version && npm --version'

if ! command -v claude >/dev/null 2>&1; then
  step "Claude Code (official stable native installer)" bash -o pipefail -c 'curl -fsSL https://claude.ai/install.sh | bash -s stable'
fi
export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  step "Astral uv (official installer)" bash -o pipefail -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
fi
export PATH="$HOME/.local/bin:$PATH"

if command -v uv >/dev/null 2>&1; then
  if ! command -v graphify >/dev/null 2>&1; then
    step "Graphify (official PyPI name: graphifyy)" uv tool install graphifyy
  fi
fi
if command -v graphify >/dev/null 2>&1; then
  # User scope: leave Git worktree clean. No analysis is run automatically.
  step "Graphify skill (user scope)" graphify install
fi

# Claude plugin installers may internally clone GitHub using SSH, even when the marketplace URL is HTTPS.
# Prefer HTTPS inside this disposable Codespace; never disable SSH host-key verification.
step "GitHub HTTPS instead of SSH for plugin clones" git config --global url."https://github.com/".insteadOf "git@github.com:"

if command -v claude >/dev/null 2>&1; then
  if ! claude plugin list 2>/dev/null | grep -Fq "agent-skills@addy-agent-skills"; then
    step "Agent Skills marketplace (HTTPS)" claude plugin marketplace add https://github.com/addyosmani/agent-skills.git
    step "Agent Skills plugin" claude plugin install agent-skills@addy-agent-skills
  fi
  if ! claude plugin list 2>/dev/null | grep -Fq "ponytail@ponytail"; then
    step "Ponytail marketplace (HTTPS)" claude plugin marketplace add https://github.com/DietrichGebert/ponytail.git
    step "Ponytail plugin" claude plugin install ponytail@ponytail
  fi
else
  printf '[FAILED] Claude unavailable; plugins need manual retry.\n' >&2
  failures=$((failures + 1))
fi

omni_enabled=1
if [[ -v LFO_INSTALL_OMNIROUTE ]]; then
  omni_enabled="$LFO_INSTALL_OMNIROUTE"
fi
if [ "$omni_enabled" = "0" ]; then
  printf '[SKIP] OmniRoute requested off.\n'
elif ! command -v omniroute >/dev/null 2>&1; then
  # Installation only. Server/router never started, configured, or exposed.
  step "OmniRoute (binary only; routing DISABLED)" npm install -g omniroute --include=optional
fi

if [ ! -d node_modules ]; then
  step "LFO npm dependencies" npm ci --no-audit --no-fund
fi
printf '\n======== INSTALLATION STATUS ========\n'
bash .devcontainer/verify.sh || true
printf 'Bootstrap failures: %s. If above 0, rerun and review errors.\n' "$failures"
printf 'Next user action: enter claude in terminal and authenticate personally.\n'
