#!/bin/bash
# PreToolUse hook — vertical boundary guard
# Warns when a Claude Code agent tries to edit a file outside its assigned vertical.
#
# Set your vertical in your shell profile:
#   export FAVO_VERTICAL=backend   # Gian
#   export FAVO_VERTICAL=pos       # Mine
#   export FAVO_VERTICAL=admin     # Mia
#   export FAVO_VERTICAL=design    # Nikao

# Read file path from stdin JSON (Claude Code passes tool context via stdin)
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

# No file path found — nothing to check
[ -z "$FILE" ] && exit 0

# No vertical set — allow everything (developer hasn't configured yet)
VERTICAL="${FAVO_VERTICAL:-}"
[ -z "$VERTICAL" ] && exit 0

# Shared areas — always allowed for any vertical
SHARED_PATHS=(
  "src/lib/"
  "src/components/shared/"
  "src/components/ui/"
  "src/hooks/"
  "src/state/"
  "src/app/layout"
  "src/app/globals"
  "tests/"
  "docs/"
  ".github/"
  ".claude/"
  "db/schema"
  "db/enums"
)

for shared in "${SHARED_PATHS[@]}"; do
  if [[ "$FILE" == *"$shared"* ]]; then
    exit 0
  fi
done

# Vertical-owned paths
declare -A VERTICAL_PATHS
VERTICAL_PATHS[backend]="src/server/ src/app/api/ db/"
VERTICAL_PATHS[pos]="src/app/pos/ src/components/pos/"
VERTICAL_PATHS[admin]="src/app/admin/ src/components/admin/"
VERTICAL_PATHS[design]="src/app/(customer)/ src/components/landing/ src/components/customer/ src/lib/design-tokens"

# If the file is in this vertical's paths — allow it
for path in ${VERTICAL_PATHS[$VERTICAL]}; do
  if [[ "$FILE" == *"$path"* ]]; then
    exit 0
  fi
done

# Check if file belongs to another vertical — warn and block
for v in backend pos admin design; do
  [ "$v" = "$VERTICAL" ] && continue
  for path in ${VERTICAL_PATHS[$v]}; do
    if [[ "$FILE" == *"$path"* ]]; then
      echo ""
      echo "⛔  VERTICAL BOUNDARY: $FILE"
      echo "    This file belongs to the '$v' vertical."
      echo "    You are set up as: '$VERTICAL'"
      echo "    Ask your supervisor before editing files outside your vertical."
      echo ""
      exit 1
    fi
  done
done

# File not in any vertical's territory — allow (could be a root config file)
exit 0
