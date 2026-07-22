# Prompt Conventions (shared reference)

These conventions are referenced by all prompt templates. They are NOT a prompt
themselves — they document the shared machinery so individual templates stay short.

## Completion markers

Every sub-agent writes a machine-detectable marker as an issue comment when it
finishes its step successfully. Markers are how `po-prepare` detects
already-done steps on re-run (idempotency) without interpreting prose.

Marker format — an HTML comment (invisible in rendered GitHub, greppable via API):

```
<!-- OD-PREPARE:<step>:done sha=<prompt-sha> -->
```

Where `<step>` is one of: `feasibility`, `testability`, `design`.

- A step is "done" if and only if its marker comment is present on the issue.
- `po-prepare` checks markers via `gh issue view <n> --json comments` and skips
  any step whose marker is already present.
- `<prompt-sha>` is the short SHA of the `prompts/` directory at invocation
  time (traceability — which prompt version produced this).

## Prompt SHA (traceability)

Every wrapper script computes:
```bash
PROMPT_SHA=$(git rev-parse --short HEAD -- prompts/ 2>/dev/null || echo "nogit")
```
and passes it into the prompt via `{{PROMPT_SHA}}`. Sub-agents include it in
their marker and in their completion comment.

## Self-reporting

Every agent updates the issue itself via `gh` at the end of its run — writes its
work product / reference, its marker, and a short human-readable comment. No
external process infers an agent's outcome. If an agent didn't report, treat the
step as not done.

## Failure posture (rule B — uniform)

Any sub-agent that cannot complete (tool error, daemon down, missing input,
ambiguous instruction it can't resolve) must:
1. NOT write a `:done` marker.
2. Post a comment explaining what failed, prefixed `<!-- OD-PREPARE:error -->`.
3. Return a failure status to its caller.

`po-prepare`, on any sub-step failure: abort the convergence, leave issue status
at `In Preparation`, relabel `agent:human`, post a summary of what failed. Never
half-finish, never loop past the stated ceiling.

## Placeholders in templates

`{{ISSUE}}` — the issue number. `{{PROMPT_SHA}}` — the prompts SHA above.
Wrapper scripts substitute these before invoking the CLI.

## CLI invocation placeholders

Exact non-interactive flags depend on your installed tool versions — fill these
in from current docs. Marked in scripts as:
- `{{CODEX_EXEC}}` — e.g. `codex exec` (+ any model/permission/sandbox flags)
- `{{CLAUDE_EXEC}}` — e.g. `claude -p` (+ any flags)
Do not hard-code until confirmed against your versions.
