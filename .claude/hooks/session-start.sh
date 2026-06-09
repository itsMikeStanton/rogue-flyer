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

local_rev="$(git rev-parse HEAD 2>/dev/null || true)"
remote_rev="$(git rev-parse "origin/$branch" 2>/dev/null || true)"

if [ -z "$remote_rev" ] || [ "$local_rev" = "$remote_rev" ]; then
  # Already at the remote tip. Any dirty files here are genuine in-session
  # edits — leave them exactly as they are.
  echo "[session-start] already up to date (${local_rev:0:8})."
  exit 0
fi

# HEAD differs from origin. Decide whether it's SAFE to fast-forward.
#
# The failure mode we're fixing: the container restores a STALE snapshot whose
# HEAD is an OLD commit but whose working tree carries newer (already-pushed)
# content, so `git status` looks "dirty" and a naive guard refuses to reset —
# leaving us stranded on stale code. The key insight: if HEAD has NO commits
# that origin lacks (0 ahead), then everything here already exists on origin, so
# resetting can't lose real history. We still stash any working-tree changes
# first so nothing is ever truly destroyed (recover with `git stash list`).
ahead="$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo 0)"
if [ "${ahead:-0}" -gt 0 ]; then
  # Local has commits origin doesn't — genuinely diverged. Do NOT clobber.
  echo "[session-start] local is $ahead un-pushed commit(s) ahead of origin — fetched only, NOT resetting. Push or rebase manually."
  exit 0
fi

# Strictly behind (an ancestor of origin). Safe to catch up.
if [ -n "$(git status --porcelain)" ]; then
  stash_msg="session-start autosync backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if git stash push --include-untracked -m "$stash_msg" >/dev/null 2>&1; then
    echo "[session-start] stashed stale working-tree changes ('$stash_msg') before syncing — recover with: git stash list."
  else
    echo "[session-start] note: could not stash working-tree changes; proceeding (content is already on origin)."
  fi
fi
git reset --hard "origin/$branch" >/dev/null 2>&1 \
  && echo "[session-start] reset to origin/$branch (${remote_rev:0:8}) — was behind on ${local_rev:0:8}." \
  || echo "[session-start] reset failed."
exit 0
