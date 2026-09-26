#!/bin/bash
# Installs dependencies so typecheck, lint and tests work in Claude Code on the web.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not npm ci) reuses the cached container's node_modules.
# Chromium is pre-installed, so Playwright must not download its own.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
