#!/bin/bash
# PreToolUse hook for Bash|PowerShell.
# Auto-allows every shell command EXCEPT a git push targeting main,
# which it hard-denies. This is the enforcement behind "do everything
# except push to main" — reliable command parsing, not a permission glob.

input=$(cat)

# Extract the command string from the tool_input JSON (no jq dependency).
cmd=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//; s/"$//')

# Detect a git push whose target is the main branch.
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push'; then
  if printf '%s' "$cmd" | grep -Eq '(origin[[:space:]]+main([[:space:]]|$)|origin[[:space:]]+HEAD:main|[[:space:]]main:|:main([[:space:]]|$)|[[:space:]]main([[:space:]]|$))'; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Pushing to main is blocked. Push to a feature branch and open a PR instead."}}'
    exit 0
  fi
fi

# Everything else: auto-allow, no prompt.
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Auto-allowed (do everything except push to main)."}}'
exit 0
