# GitHub Actions / Pages Deployment Failure Report

**Run:** #98 (workflow `ci-cd.yml`, both Attempt #1 and Attempt #2/latest)  
**Repository:** `AKCD1998/RepWeb1011`  
**Date:** 2026-07-06

## 1. Root cause

The deploy failed inside GitHub's own Pages publishing backend, not in this repository's build or workflow logic. In both Attempt #1 and Attempt #2, the `Deploy to GitHub Pages` step successfully uploaded the artifact, successfully created a Pages deployment (received a deployment ID), and only then failed while polling deployment status, returning GitHub's own generic error `Error: Deployment failed, try again later.` This is the signature of a GitHub Pages backend-side publishing failure occurring after the workflow had already handed off successfully, not a build, permissions, or artifact-selection problem.

## 2. Evidence

- `Build And Verify` job: passed in 20s (green check), no errors.
- Deploy job steps `Build frontend` and `Validate built API target`: both passed before the artifact upload.
- `Upload Pages artifact` step log (Attempt #2): `Artifact github-pages-2 has been successfully uploaded! Final size is 320282 bytes. Artifact ID is 8100925945`
- `Deploy to GitHub Pages` step log (Attempt #2): `Fetching artifact metadata for "github-pages-2" in this workflow run` -> `Found 2 artifact(s)` -> `Creating Pages deployment with payload: {"artifact_id": 8100925945, ...}` -> `Created deployment for 593690572a01c737e0955983a0dc00b3a8f99186, ID: 593690572a01c737e0955983a0dc00b3a8f99186` -> `Getting Pages deployment status...` -> `Error: Deployment failed, try again later.`
- Attempt #1 shows the identical pattern with a different artifact: `github-pages-1`, artifact_id `8100461867`, `Found 1 artifact(s)`, a deployment was created, then the same `Error: Deployment failed, try again later.`
- Workflow YAML defines `PAGES_ARTIFACT_NAME: github-pages-${{ github.run_attempt }}`, and both the upload and deploy steps reference this exact same env var. The artifact fetched and the artifact ID used in the deployment payload match exactly what was just uploaded in that same attempt.
- Job permissions block: `contents: read`, `pages: write`, `id-token: write`, environment `github-pages` — consistent with a deployment ID actually being issued. An OIDC or permissions failure would fail before `Created deployment`, not after.
- `github-pages` environment settings: no required reviewers, no wait timer, deployment restricted to branch `main` only (matches the trigger branch) — no protection rule is blocking or delaying the run.
- Repo Pages settings: Source = `GitHub Actions`, site confirmed live at `https://akcd1998.github.io/RepWeb1011/`, `Last deployed by AKCD1998` — Pages is correctly configured and has published successfully before.

## 3. What is NOT the cause

- Not duplicate or ambiguous `github-pages` artifact selection — the workflow already uses a unique per-attempt name (`github-pages-1`, `github-pages-2`), and the logs prove the exact artifact ID used for deployment matches the one just uploaded in that same attempt.
- Not a build failure — `Build And Verify`, `Build frontend`, and `Validate built API target` all passed in both attempts.
- Not a permissions, OIDC, or environment configuration problem — the deployment was successfully created, which requires valid `id-token` and `pages` permissions and environment access.
- Not a workflow YAML bug in artifact wiring — artifact names, permissions, and `deploy-pages` inputs are correctly and consistently wired between the upload and deploy steps.
- Not the Node.js 20 -> 24 deprecation warning — this is informational and appears on passing steps too.

## 4. Confidence

**Medium.** The evidence clearly rules out build, permission, and artifact-selection causes, and the failure text is GitHub's own opaque backend message occurring strictly after successful deployment creation, which strongly points to a transient or backend-side Pages publishing failure. Confidence is not marked high because GitHub does not expose deeper backend logs to the repository owner through the workflow view.

## 5. Recommended next step

Re-run the workflow or trigger it again via `workflow_dispatch` or a new push after a short wait, since the failure point is GitHub's Pages backend rather than anything in this repo. If it fails repeatedly with the same `Getting Pages deployment status... Error: Deployment failed, try again later.` signature, escalate to GitHub Support and include the deployment IDs from the failed runs.

## Final verdict

The deploy failed because GitHub's Pages backend rejected or failed the already-successfully-created deployment during status polling (`Deployment failed, try again later.`). This is a Pages publishing failure, not a frontend build, permissions, environment, or duplicate-artifact issue in this repository's workflow.
