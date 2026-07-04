# Run & Test Runbook

This is the exact sequence to get the workflow running on your Mac, verify
each stage works, and then record the demo. Everything here runs on your own
machine — the commands below are for your terminal, not this chat.

## Phase 0 — Sanity check Ollama (should already work)

```
ollama list
ollama serve &          # if not already running as a service
curl http://localhost:11434/api/tags   # should return your model list as JSON
```

## Phase 1 — Test the AI pipeline locally, without n8n

This is the fastest way to confirm resume extraction + parsing + scoring
actually work with your local models, before touching n8n at all.

```
cd resume-screening-automation/scripts
npm install
npm test                 # runs validate.test.js — should print "21 tests passed."

node test_pipeline.js ../sample-data/resume_strong_match_priya_sharma.docx
node test_pipeline.js ../sample-data/resume_medium_match_arjun_verma.docx
node test_pipeline.js ../sample-data/resume_weak_match_neha_kapoor.pdf
```

Each run prints: extracted resume text length → parsed candidate JSON →
JD-match JSON → the deterministic Shortlist/Manual Review/Reject decision →
the final combined record. You should see the strong-match resume score
noticeably higher than the weak-match one. If `gpt-oss:20b` is slow, try it
once for comparison:

```
OLLAMA_MODEL=gpt-oss:20b node test_pipeline.js ../sample-data/resume_strong_match_priya_sharma.docx
```

If this phase doesn't produce sensible JSON, fix it here first — n8n adds
complexity on top of the exact same logic, so a working `test_pipeline.js`
run all but guarantees the n8n version will work too.

## Phase 2 — Start n8n + NocoDB

You can run these directly via `npx` — no Docker needed. Use two terminal tabs
so both stay running.

**Tab 1 — n8n:**
```
export NODE_FUNCTION_ALLOW_EXTERNAL=mammoth
export NODE_FUNCTION_ALLOW_BUILTIN=fs,crypto
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3.2:3b
export JD_FILE_PATH="$(pwd)/sample-data/job_description.md"
npx n8n
```
(first run downloads n8n — give it a minute or two)

**Tab 2 — NocoDB:**
```
npx create-nocodb-app
```

Open:
- n8n: http://localhost:5678 (first run asks you to create an owner account — any email/password, stays local)
- NocoDB: http://localhost:8080 (same — create an account, it's local only)

Since Ollama runs natively on your Mac (not containerized), `OLLAMA_BASE_URL=http://localhost:11434`
works as-is — no Docker networking tricks needed.

<details>
<summary>Alternative: Docker (if you'd rather use containers)</summary>

```
cd resume-screening-automation
docker compose up -d
docker compose logs -f n8n     # wait for "Editor is now accessible"
```

Same URLs as above. `docker-compose.yml` in this repo already sets
`OLLAMA_BASE_URL=http://host.docker.internal:11434` so the container can
reach your host's Ollama.
</details>

## Phase 3 — Set up NocoDB

1. Create a base called `Recruitment`.
2. Create the `Candidates` table using `schema/nocodb_field_spec.md` as the
   field-by-field guide (fastest: create fields one at a time via the "+"
   column button — takes about 5 minutes for all 27 fields).
3. Create the `workflow_error_log` table (4 fields — see `schema/schema.sql`
   bottom section).
4. Account menu (top right) → Tokens → create a token, copy it.
5. Note your base ID and table IDs: open a table, click the "..." menu →
   "Copy API URL" — the IDs are in that URL
   (`.../api/v2/tables/<tableId>/records`, base id shown in the base settings page).
6. Put those IDs into a `.env` file (copy from `.env.example`) and either
   `docker compose --env-file .env up -d` again, or just paste them directly
   into the relevant n8n node parameters after import (Phase 4).

## Phase 4 — Import the workflows into n8n

1. n8n → Workflows → Import from File → `workflow/resume_screening_workflow.json`.
2. n8n → Workflows → Import from File → `workflow/error_handler_workflow.json`.
3. In the main workflow: open each node that shows a red credential warning
   (Gmail Trigger, both NocoDB nodes' siblings, Gmail send, Google Calendar)
   and select/create the matching credential:
   - **Gmail OAuth2 - Recruitment Inbox** — Google Cloud Console → enable
     Gmail API → OAuth client → paste Client ID/Secret into n8n → Connect.
   - **NocoDB API Token** — paste the token from Phase 3.
   - **Google Calendar OAuth2** — same Google Cloud project, enable Calendar
     API, new credential, Connect.
4. In the main workflow's Settings (gear icon, top right) → set "Error
   Workflow" to the imported `Resume Screening - Error Handler` workflow.
5. Save both workflows. Activate the main workflow (toggle top-right) once
   you're ready for it to run automatically off real emails — leave it
   deactivated while you're still testing so it doesn't process real mail
   mid-setup.

## Phase 5 — Manual test run inside n8n (no email needed yet)

Rather than waiting for the Gmail poll, you can test the pipeline manually:

1. Open the workflow, click on "Gmail Trigger - Recruitment Inbox", click
   "Fetch Test Event" (n8n will pull a recent matching email) — or —
2. Temporarily replace the trigger during testing: right-click canvas → add
   a "Manual Trigger" wired to a small Code node that fabricates one item
   with a `binary.attachment` populated from a sample file (use n8n's "Read
   Binary File" node pointed at `sample-data/resume_strong_match_priya_sharma.docx`
   feeding into "Extract Attachments & Metadata" — for a quick manual test
   you can also just click "Execute Workflow" on the Gmail Trigger node
   directly if a matching email already exists in the inbox).
3. Click "Execute Workflow" and watch each node populate with data,
   left-to-right. Click on any node after execution to inspect its output —
   this is exactly what you should show on screen during the demo.

## Phase 6 — Real end-to-end test

1. Send yourself an email (to the address the Gmail Trigger polls) with
   subject like "Application for Backend Engineer" and attach
   `resume_strong_match_priya_sharma.docx`.
2. Within ~1 minute (poll interval), a new execution should appear in n8n's
   Executions tab.
3. Check NocoDB — a new row should appear in `Candidates` with all fields
   populated, `Recommendation = Shortlist`, `ApplicationStatus = Interview Scheduled`
   (if score ≥ 80).
4. Check your inbox — you should receive the interview invitation email.
5. Check Google Calendar — a new event should appear.
6. Repeat with `resume_medium_match_arjun_verma.docx` (should land as
   Manual Review, no interview scheduled) and
   `resume_weak_match_neha_kapoor.pdf` (should land as Rejected).
7. For the error-handling part of the demo: send an email with a `.txt`
   attachment (unsupported format) and show that no candidate record is
   created and no error is thrown — then, to show the *error path*
   specifically, temporarily stop the NocoDB container
   (`docker compose stop nocodb`) and re-run one execution to show the error
   workflow firing (check `workflow_error_log` after restarting NocoDB, or
   just show the failed execution + red error banner in n8n before
   restarting it).

Screen recording tool: QuickTime Player (Mac, built in) → File → New Screen
Recording, or any tool you already have.
