#!/usr/bin/env bash
# scripts/clear-cache.sh
# Force the next Kilo session to re-download my-skills from CF Pages.
#
# When to use:
#   - Plugin code changes were pushed but VSCodium still runs old behavior
#   - skills/ files don't appear after reload / restart
#   - GH build deployed new tarball but local cache holds old bytes
#
# Why it matters:
#   Bun caches tarball installs by URL. Same URL = same cache entry = old code.
#   Clearing forces a fresh download on the next Kilo startup.
#
# Safe to run multiple times. Only touches my-skills caches; leaves other plugins
# and kilo state intact.

set -e

KILO_CACHE="$HOME/.cache/kilo/packages/my-skills@https:"
BUN_TAR_CACHE="$HOME/.bun/install/cache/https:/my-skills-atd.pages.dev"

echo "Clearing my-skills caches (Bun tarball install + kilo plugin cache)"

removed=0

if [ -d "$KILO_CACHE" ]; then
  echo "  removing $KILO_CACHE"
  rm -rf "$KILO_CACHE"
  removed=$((removed + 1))
else
  echo "  $KILO_CACHE (already absent)"
fi

if [ -d "$BUN_TAR_CACHE" ]; then
  echo "  removing $BUN_TAR_CACHE"
  rm -rf "$BUN_TAR_CACHE"
  removed=$((removed + 1))
else
  echo "  $BUN_TAR_CACHE (already absent)"
fi

echo
echo "Done. Next Kilo session start will re-download from CF Pages."
echo "If you are running Kilo Code in VSCodium: reload the window (Cmd+Shift+P -> 'Developer: Reload Window')."