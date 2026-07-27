#!/usr/bin/env bash
# run-gate.sh — the ONE line of indirection between lefthook and the gates.
# Copy to each adopting repo as `.lefthook/run-gate.sh` (tracked), then:
#   lefthook install
#
# WHY THIS FILE EXISTS (transformate WI-2412, 2026-07-27)
# lefthook v2.1.10 does its OWN variable substitution on `run:` BEFORE any shell sees the
# string, and it is not a shell:
#   ${VAR:-default}  →  substitutes `${VAR` and leaves the literal `:-default` behind
#   $$               →  the PID
#   \$VAR            →  no escape; still substituted
#   $UNSET           →  the empty string, silently
# So the old reference invocation `bash "${CODE_BUILD_SKILL_DIR:-$HOME/...}/panel-gate.sh"`
# ran as `bash ":-$HOME/.../panel-gate.sh"` → **exit 127**. Repos carrying it could not push
# at all, and the obvious unblock (delete the hook) leaves NO repo-side wall — which is how
# the doctrine-v4 "physically gated" layer came to be un-run on those repos.
# The deeper trap: because lefthook expands every `$NAME` from its own environment, NO
# shell-side defaulting of any kind survives inside `run:`. There is no clever quoting. The
# only robust answer is a `run:` line with no `$` in it — hence this shim, where a real bash
# does the resolution.
#
# RESOLUTION ORDER — canonical first, vendored copy as a last resort:
#   1. $CODE_BUILD_SKILL_DIR   — explicit override, always wins
#   2. ~/.claude/skills/code-build — the CANONICAL gates. Preferred, so a gate improvement
#      reaches every repo at once instead of per-repo copies drifting (2026-07-27: vendored
#      copies were 8-16 KB against a 55 KB canonical gate, i.e. missing the manifest
#      ownership gate, the strict-quorum chain and the degrade report).
#   3. a repo-VENDORED copy at the repo root or ./scripts — because some repos vendored the
#      gates deliberately to be self-contained (learnhub, transformate WI-2240). Without
#      this arm, adopting the shim would fail CLOSED on any host that has the repo but not
#      the skill — e.g. a trainee's machine or CI — turning a review improvement into "no
#      HOFMI trainee can push today". A stale wall beats no wall, and it says so out loud.
# FAIL CLOSED only when none of the three resolves: an unresolvable gate is the exact state
# this file exists to stop being silent about, so skipping is not an option.

set -uo pipefail

GATE="${1:-}"
shift || true
if [ -z "$GATE" ]; then
  echo "run-gate: no gate named. Usage: run-gate.sh <panel-gate.sh|wi-gate.sh>" >&2
  exit 1
fi

RESOLVED=""
VENDORED=no
OVERRIDDEN=no

_root="$(git rev-parse --show-toplevel 2>/dev/null || printf '.')"
_root_real="$(cd "$_root" 2>/dev/null && pwd -P || printf '%s' "$_root")"

# Does this file actually look like a fleet gate? Applied to EVERY arm, not just the
# vendored one (learnhub panel R2: opus MAJOR, grok MAJOR — convergent). A truncated or
# zero-byte `~/.claude/skills/code-build/panel-gate.sh` is the dangerous case: `bash` on an
# empty file exits 0, so the pre-push wall would report success and let every push through
# in silence. That is a fail-OPEN in the one component whose entire job is to fail closed.
# It is a sanity check against truncation, a stub, or an unrelated same-named file — NOT a
# security boundary; a malicious committer is out of this layer's threat model.
gate_looks_real() {  # <file> -> 0 plausible / 1 no
  [ -s "$1" ] || return 1
  grep -qE 'PANEL-MANIFEST|PANEL_OVERRIDE|BRYNN_WI_OVERRIDE|panel gate v4' "$1" 2>/dev/null
}
# NOT a size floor. Panel R5 (sol MAJOR) proposed one, or an end-of-file sentinel, to catch a
# gate truncated PART-way — one that still carries the marker near its top. Declined: a
# half-written gate needs an interrupted write, whereas git checkout writes each file
# atomically, so the realistic corruption is the ZERO-BYTE file (a failed create or cp), and
# `-s` already catches that. A floor would also force every legitimate small or future gate to
# pad itself past an arbitrary number, which is the kind of rule that gets deleted the first
# time it is inconvenient. Recorded as a declined finding rather than silently dropped.

# Case-insensitive on Windows, where the same directory is reachable as C:/… and c:/…
# (learnhub panel, opus MINOR) — a case difference would defeat the worktree-containment
# guard below.
path_eq_or_under() {  # <candidate> <root>
  local c="$1" r="$2"
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) c="$(printf '%s' "$c" | tr 'A-Z' 'a-z')"; r="$(printf '%s' "$r" | tr 'A-Z' 'a-z')" ;;
  esac
  [ "$c" = "$r" ] || case "$c" in "$r"/*) return 0 ;; *) return 1 ;; esac
}

# An EXPLICIT override that cannot be honoured is an ERROR, not a reason to quietly use a
# different gate (learnhub panel: sol MAJOR, grok MAJOR). Someone who sets this var has
# stated which wall must run; falling back silently means the push is gated by something
# other than what the operator asked for, and nobody finds out. Fail closed instead.
if [ -n "${CODE_BUILD_SKILL_DIR:-}" ]; then
  _ovr_err=""
  # Trim surrounding whitespace before validating (learnhub panel, opus MINOR): a value
  # picked up from a config file or a here-doc often carries a trailing space or CR, and an
  # untrimmed value fails the absolute-path test for a reason nobody can see.
  _ovr_in="$(printf '%s' "$CODE_BUILD_SKILL_DIR" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  case "$_ovr_in" in
    /*|[A-Za-z]:[/\\]*) ;;
    *) _ovr_err="it is not an absolute path" ;;
  esac
  if [ -z "$_ovr_err" ]; then
    _ovr_real="$(cd "$_ovr_in" 2>/dev/null && pwd -P)" || _ovr_real=""
    if [ -z "$_ovr_real" ]; then _ovr_err="the directory does not exist"
    elif [ ! -f "$_ovr_real/$GATE" ]; then _ovr_err="it holds no '$GATE'"
    else
      # Resolve the GATE FILE, then test containment on that (learnhub panel, sol MAJOR):
      # testing only the directory misses a dir outside the tree whose gate file resolves
      # back inside it. An override pointing at repo content is the one thing it must never
      # do — .envrc, a CI export or a README instruction is enough to set it.
      _ovr_file="$(cd "$(dirname "$_ovr_real/$GATE")" 2>/dev/null && pwd -P)/$(basename "$GATE")"
      if path_eq_or_under "$_ovr_file" "$_root_real"; then
        _ovr_err="it resolves inside the repository being pushed ($_ovr_file)"
      fi
    fi
  fi
  if [ -n "$_ovr_err" ]; then
    echo "run-gate: PUSH BLOCKED — CODE_BUILD_SKILL_DIR is set but unusable: $_ovr_err." >&2
    echo "  value: $CODE_BUILD_SKILL_DIR" >&2
    echo "  An explicit override names the wall that must run; silently using a different" >&2
    echo "  gate would hide that. Fix or unset it." >&2
    exit 1
  fi
  RESOLVED="$_ovr_real/$GATE"; OVERRIDDEN=yes
fi

if [ -n "$RESOLVED" ]; then
  :
elif [ -n "${HOME:-}" ] && [ -f "$HOME/.claude/skills/code-build/$GATE" ]; then
  RESOLVED="$HOME/.claude/skills/code-build/$GATE"
else
  # Vendored fallback, resolved from the REPO ROOT rather than the process CWD. Note this is
  # belt-and-braces for the GATE lookup only: lefthook does run `run:` from the repo root, and
  # it must — the `run:` line names this file relatively, so a different cwd would fail to find
  # the shim at all, before any of its logic ran (panel R4, opus MAJOR: an earlier version of
  # this comment implied otherwise and contradicted itself).
  # A bare filename search would also exec any file that happens to be called panel-gate.sh
  # (learnhub panel, opus MAJOR), so require the file to LOOK like the real gate. This is a
  # sanity check against an unrelated or stub script, NOT a security boundary: a repo that
  # can add a fake gate can equally edit lefthook.yml or this shim, and a malicious
  # committer is explicitly outside this layer's threat model.
  for _c in "$_root/$GATE" "$_root/scripts/$GATE" "$_root/.lefthook/$GATE"; do
    [ -f "$_c" ] || continue
    if gate_looks_real "$_c"; then RESOLVED="$_c"; VENDORED=yes; break; fi
    echo "run-gate: ignoring $_c — it does not look like a fleet gate (no manifest/override markers)." >&2
  done
fi

# ONE sanity check over WHICHEVER arm won, including the canonical skill dir (learnhub panel
# R2: opus MAJOR + grok MAJOR, convergent). Checking only the vendored arm left the dangerous
# case open: a truncated or zero-byte canonical panel-gate.sh makes `bash` exit 0, so the wall
# would report success and pass every push in silence — a fail-OPEN in the one component whose
# whole job is to fail closed.
if [ -n "$RESOLVED" ] && ! gate_looks_real "$RESOLVED"; then
  echo "run-gate: PUSH BLOCKED — '$RESOLVED' exists but does not look like a fleet gate" >&2
  echo "  (empty, truncated, or not the real script). An unrunnable gate must never read as a" >&2
  echo "  pass: bash on an empty file exits 0, which would silently open the wall." >&2
  exit 1
fi

if [ -z "$RESOLVED" ]; then
  echo "run-gate: PUSH BLOCKED — gate '$GATE' not found." >&2
  echo "  looked in: \$CODE_BUILD_SKILL_DIR, ~/.claude/skills/code-build, ./, ./scripts, ./.lefthook" >&2
  echo "  The code-build skill is missing on this host and this repo vendors no copy." >&2
  echo "  Refusing the push rather than skipping the review wall." >&2
  echo "  Install the skill (or set CODE_BUILD_SKILL_DIR); do not delete the hook." >&2
  exit 1
fi

if [ "$OVERRIDDEN" = yes ]; then
  echo "run-gate: NOTE — CODE_BUILD_SKILL_DIR override in effect; the push gate for this" >&2
  echo "  push is $RESOLVED, not the canonical skill copy." >&2
fi

if [ "$VENDORED" = yes ]; then
  echo "run-gate: NOTE — using this repo's VENDORED $GATE ($RESOLVED); the canonical" >&2
  echo "  code-build skill is not installed on this host, so gate fixes since the copy was" >&2
  echo "  taken are NOT in effect. The wall still runs. Install the skill when you can." >&2
fi

# exec: panel-gate.sh reads git's pre-push ref lines from stdin (its lefthook entry sets
# use_stdin), so the child must inherit this process's stdin directly rather than a copy that
# has already been drained. wi-gate.sh ignores stdin; exec is harmless for it.
exec bash "$RESOLVED" "$@"
