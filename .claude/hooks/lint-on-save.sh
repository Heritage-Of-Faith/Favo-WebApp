#!/bin/bash
# PostToolUse hook — auto-lint after every file edit
# Runs ESLint --fix on the file that was just written or edited.
# Exits 0 always — lint errors are shown to Claude to fix, not used to block.

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

# No file path — skip
[ -z "$FILE" ] && exit 0

# Only lint TypeScript/JavaScript files
if [[ ! "$FILE" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Run lint with --fix (auto-fixes simple issues like missing semicolons, trailing commas)
# Use --quiet to suppress warnings and only show errors
OUTPUT=$(bun lint "$FILE" --fix --quiet 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "⚠️  Lint issues found in $FILE:"
  echo "$OUTPUT"
  echo "Please fix the lint errors above before committing."
fi

# Always exit 0 — Claude will see the output and fix remaining issues
exit 0
