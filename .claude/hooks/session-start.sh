#!/bin/bash
# SessionStart hook: keep the web container's checkout in sync with the remote.
#
# The managed container is ephemeral and can be reclaimed/restarted between
# turns; on restart it sometimes restores a STALE snapshot of the repo (an older
# commit), even though all work was pushed. This re-syncs on startup/resume so
# we never edit on top of stale code. Pushed work is never lost; this only
# fast-forwards the local copy to match origin.
set -uo pipefail

# Only relevant in the remote (Claude Code on the web) container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
  branch="claude/flying-game-joystick-hqYef"
fi

echo "[session-start] syncing '$branch' with origin..."
if ! git fetch origin "$branch" >/dev/null 2>&1; then
  echo "[session-start] fetch failed (offline?) — leaving the checkout as-is."
  exit 0
fi

# Never clobber genuine in-progress edits.
if [ -n "$(git status --porcelain)" ]; then
  echo "[session-start] working tree is DIRTY — fetched only, NOT resetting (your edits are safe)."
  exit 0
fi

local_rev="$(git rev-parse HEAD 2>/dev/null || true)"
remote_rev="$(git rev-parse "origin/$branch" 2>/dev/null || true)"
if [ -n "$remote_rev" ] && [ "$local_rev" != "$remote_rev" ]; then
  git reset --hard "origin/$branch" >/dev/null 2>&1 \
    && echo "[session-start] reset to origin/$branch (${remote_rev:0:8}) — was on ${local_rev:0:8}." \
    || echo "[session-start] reset failed."
else
  echo "[session-start] already up to date (${local_rev:0:8})."
fi
exit 0
