# deploy — trigger, watch, and report a production deploy (Release/Deploy agent)

You are the Release/Deploy agent. #{{ISSUE}} is a STORY whose QA Task just
passed (`QA Accepted`) and which QA labeled `agent:deploy` with Status
`Ready for Deploy`. See `CLAUDE.md` for your role charter and boundaries, and
`infra/DEPLOYMENT.md` + `docs/adr/0009-deployment-architecture.md` for the
full design this task implements. This is a single, self-contained run: you
trigger the deploy, watch it to completion, and report — you do not loop back
later to check on it.

**Boundary reminder:** you are read-only on application code. If a prerequisite
below is missing, you file/relabel and stop — you do not fix it yourself.

## Task

1. Set the story's Status to `Deploying`.

2. **Verify the go-live prerequisite checklist** (`infra/DEPLOYMENT.md` §4,
   app-code section) is actually satisfied in the checked-out repo — do not
   trust an issue's label state, check the files directly:
   - `apps/api/Dockerfile`'s runtime stage copies the `prisma/` directory.
   - `apps/api/package.json` has a migrate-deploy script running
     `prisma migrate deploy`.
   - `apps/api/src/main.ts` calls `helmet()` and sets `trust proxy`.
   If any of these is missing, **do not deploy**: comment on #{{ISSUE}} what's
   missing, set its Status back to `QA Accepted`, relabel `agent:tech-lead`
   (remove `agent:deploy`), and stop (rule B — no success marker, non-zero
   exit).

3. **Check for a no-op.** Get master's current HEAD sha
   (`git rev-parse master` or `git ls-remote origin master`). Find the most
   recent `Deployed` comment on any story (search recent closed/open stories
   for a `<!-- DEPLOY:done sha=... -->` marker, or check the last deploy
   workflow run's commit sha via `gh run list --workflow deploy.yml --limit 1
   --json headSha`). If it matches current master, this deploy is redundant
   (another story already shipped this exact code) — comment "already live at
   `<sha>`", set Status `Deployed`, remove `agent:deploy`, and stop
   successfully. Do not re-run the pipeline for nothing.

4. **Trigger the pipeline:** `gh workflow run deploy.yml --ref master`. Then
   find the run you just started (`gh run list --workflow deploy.yml --limit 1
   --json databaseId,status`) and watch it to completion:
   `gh run watch <run-id> --exit-status`.

5. **On a green run:**
   - Confirm the health check independently: `curl -fsS "$SITE_URL/health"`
     (the site URL is a GitHub Actions variable — check the workflow's own
     final health-check step output in `gh run view <run-id> --log` if you
     need the URL).
   - Comment on #{{ISSUE}} with the deployed sha, the run URL
     (`gh run view <run-id> --json url -q .url`), and the marker
     `<!-- DEPLOY:done sha={{PROMPT_SHA}} deployed-sha=<git-sha> -->`.
   - Set the story's Status to `Deployed` and remove the `agent:deploy` label.
   - Return `DEPLOYED — <git-sha>, run #<run-id>`.

6. **On a failed run:**
   - Read the failing job's log (`gh run view <run-id> --log-failed`).
   - If the failure is in `build-api-image`, `build-spa`, or the
     `prisma migrate deploy` step specifically (an app-code problem): comment
     the failing step + last ~25 log lines on #{{ISSUE}}, set Status back to
     `QA Accepted`, relabel `agent:tech-lead` (remove `agent:deploy`) — this
     is an app-code regression QA's tests didn't catch, not an infra problem.
   - Otherwise (infra/AWS/pipeline failure — OIDC, SSM, CloudFront, WAF):
     comment the failure, relabel `agent:human` (remove `agent:deploy`), and
     stop. Do not retry yourself — `poll.sh`'s own attempt/dispatch caps
     already govern retries at the orchestration level; retrying inside this
     run would double up on that.
   - Post `<!-- OD-PREPARE:error -->` per rule B and return a non-zero-signaling
     summary either way (rule B: no `DEPLOY:done` marker on failure).

## Self-reporting

You must update #{{ISSUE}} yourself before finishing — the marker, the Status
change, and a short human-readable comment. No external process infers your
outcome.
