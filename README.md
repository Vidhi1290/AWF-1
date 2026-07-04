# 🤖 AI Resume Screening & Interview Scheduling

**Round 3 Technical Assignment — Task 3 — Anthrasync**

An end-to-end n8n workflow that watches a recruitment inbox, extracts and
parses resumes with a locally-hosted LLM, scores every candidate against a
job description, stores structured records in NocoDB, and automatically
schedules interviews for shortlisted candidates — while keeping a human
recruiter in control of the final call.

> **Zero paid API keys.** LLM inference runs entirely on local [Ollama](https://ollama.com)
> models (`llama3.2:3b` / `gpt-oss:20b`), storage is self-hosted NocoDB, and
> Gmail + Google Calendar use free OAuth2 — no billing, no rate limits, no
> vendor lock-in.

---

## 📁 What's in this repo

```
resume-screening-automation/
├── workflow/
│   ├── resume_screening_workflow.json   # ⭐ main n8n workflow — import this
│   └── error_handler_workflow.json      # error logging + recruiter alert sub-workflow
├── prompts/
│   ├── resume_parsing_prompt.md         # Step 3 — resume → structured JSON
│   └── jd_matching_prompt.md            # Step 4 — candidate vs. JD scoring
├── schema/
│   ├── schema.sql                       # reference DDL
│   ├── nocodb_field_spec.md             # field-by-field NocoDB table spec
│   └── candidates_import_template.csv   # fastest way to create the table (CSV import)
├── sample-data/
│   ├── job_description.md               # sample JD used for testing
│   ├── generate_samples.py              # regenerates the sample resumes below
│   ├── resume_strong_match_priya_sharma.docx    # → Match Score 70, Manual Review
│   ├── resume_medium_match_arjun_verma.docx     # → Match Score 70, Manual Review
│   └── resume_weak_match_neha_kapoor.pdf        # → low match, Reject
├── scripts/
│   ├── validate.js                      # Step 5 data validation/cleaning logic
│   ├── validate.test.js                 # unit tests (25 passing)
│   ├── test_pipeline.js                 # local end-to-end harness (no n8n needed)
│   └── package.json
├── docker-compose.yml                   # optional containerized stack
├── RUN_AND_TEST.md                      # exact command-by-command runbook
├── .env.example
└── README.md                            # you are here
```

---

## 🧠 Architecture

```
Gmail Trigger — Recruitment Inbox (poll every 1 min, filter: has attachment + pdf/docx)
  → Extract Attachments & Metadata (Code)        [ignores emails w/o PDF/DOCX — no error]
  → Route By File Type (Switch: pdf / docx)
      ├─ Extract PDF Text (Extract From File)  ─┐
      └─ Extract DOCX Text (Code + mammoth)    ─┴→ Merge Resume Text (Append)
  → Guard: Extraction Succeeded (Code)              [error handling — empty text is flagged, not thrown]
  → Build Resume Parsing Prompt (Code)
  → Ollama — Parse Resume (HTTP → local LLM, format: json)
  → Parse & Validate Resume JSON (Code)             [Step 5: safe parse + cleaning]
  → Load Job Description (Code, reads from disk)
  → Build JD Match Prompt (Code)
  → Ollama — JD Match (HTTP → local LLM)
  → Parse & Validate Match JSON (Code)
  → Shortlisting Logic (Code)                       [Step 7: deterministic threshold rules
                                                        + re-merges email metadata that the
                                                        HTTP nodes would otherwise drop]
  → Check Duplicate — NocoDB lookup by ResumeHash    [bonus: duplicate candidate detection]
  → Determine Duplicate Status (Code)
  → Is Duplicate?
      ├─ yes → Log Duplicate Skip (stop, no new record)
      └─ no  → Map to NocoDB Columns (Code, snake_case → NocoDB PascalCase)
              → Create Candidate Record (NocoDB)
              → Is Shortlisted?
                  ├─ yes → Send Interview Invitation (Gmail)
                  │        → Create Interview Event (Google Calendar)
                  │        → Find Candidate Record (NocoDB, fresh lookup by Email)
                  │        → Update Status → Interview Scheduled (NocoDB)
                  └─ no  → ends here (Manual Review / Rejected candidates sit in
                           NocoDB for recruiter review — see Step 9)
```

A separate workflow, `error_handler_workflow.json`, is wired as the main
workflow's Error Workflow (n8n Error Trigger) and logs any node failure to a
`workflow_error_log` table plus emails the recruiter.

---

## 🎯 Why this design (key decisions)

- **Deterministic shortlisting, LLM-informed scoring.** The LLM produces
  `match_score` and its own `ai_recommendation_raw` opinion, but the
  *official* `Recommendation` / `ApplicationStatus` fields are computed by a
  plain JS threshold function (Step 7), never by asking the model to decide.
  This keeps the business rule auditable and stable even as model output
  phrasing drifts across runs.
- **Local models need defensive JSON handling.** `llama3.2:3b` occasionally
  wraps JSON in prose, code fences, or returns nested objects inside list
  fields instead of flat strings. Every LLM call is followed by a Code node
  that strips fences, greedily extracts the outer `{...}` block, repairs
  trailing commas, flattens any accidental objects-in-arrays, and falls back
  to a safe empty-but-valid object rather than crashing the workflow.
- **HTTP nodes overwrite `$json` — so named-node references are used
  everywhere downstream.** n8n's HTTP Request node replaces the item's JSON
  with the raw API response. Rather than relying on data silently flowing
  through, every downstream node that needs original candidate data
  references it explicitly (e.g. `$('Shortlisting Logic').item.json.email`),
  and `Shortlisting Logic` explicitly re-merges the email metadata captured
  at the very start of the pipeline so nothing is lost.
- **Fresh lookup before every update.** Rather than trusting a NocoDB row ID
  cached from earlier in the same run, `Update Status → Interview Scheduled`
  is preceded by a `Find Candidate Record` node that looks the row up fresh
  by email immediately before writing to it — the most robust pattern when
  a single workflow both creates and later updates the same record.
- **No item = no processing, safely.** Emails without a PDF/DOCX attachment
  simply produce zero output items from "Extract Attachments & Metadata" —
  n8n skips downstream execution for them automatically. No error, no
  dead-end branch to maintain.
- **Duplicate detection (bonus).** Each resume's normalized text is SHA-256
  hashed and checked against existing `ResumeHash` values in NocoDB before
  creating a new record, so a candidate re-applying (or a forwarded resume)
  doesn't create a duplicate pipeline entry.

---

## 🚀 Quickest path to running this

See **[`RUN_AND_TEST.md`](./RUN_AND_TEST.md)** for the exact command-by-command
runbook: local pipeline test (no n8n needed) → start n8n + NocoDB → import →
credentials → manual test → real email test → recording structure. The
primary path uses `npx` directly (no Docker required); Docker is documented
as an optional alternative.

### 1. Ollama (already installed locally)

```bash
ollama list
# should show llama3.2:3b (default) and/or gpt-oss:20b
ollama serve            # if not already running — exposes http://localhost:11434
curl http://localhost:11434/api/tags   # sanity check
```

### 2. Start n8n

```bash
export NODE_FUNCTION_ALLOW_EXTERNAL=mammoth
export NODE_FUNCTION_ALLOW_BUILTIN=fs,crypto
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=llama3.2:3b
export JD_FILE_PATH="$(pwd)/sample-data/job_description.md"
npx n8n
```

Open `http://localhost:5678`, create a local owner account (first run only).

> ⚠️ On some machines Node resolves `localhost` to IPv6 (`::1`) while Ollama
> only binds `127.0.0.1`, causing a "connection refused" error from n8n's
> HTTP Request nodes even though `curl localhost:11434` works fine from the
> terminal. If you hit this, hardcode `http://127.0.0.1:11434/api/generate`
> directly in the URL field of both `Ollama - Parse Resume` and
> `Ollama - JD Match` nodes.

### 3. Start NocoDB

```bash
npx create-nocodb-app
```

Open `http://localhost:8080`, create a local account (first run only).

1. Create a base called `Recruitment`.
2. Create the candidates table via **Import → CSV** using
   `schema/candidates_import_template.csv` — this is by far the fastest way
   to get all 31 correctly-named columns plus one sample row (delete the
   sample row afterwards, it's marked "safe to delete"). Alternatively,
   build it field-by-field from `schema/nocodb_field_spec.md`.
3. Create the `workflow_error_log` table (4 fields — see bottom of `schema/schema.sql`).
4. Account menu → **Tokens** → create a token, copy it.
5. Open the candidates table and note the **Base ID** and **Table ID** from
   the URL: `.../dashboard/#/nc/<BASE_ID>/<TABLE_ID>`.

### 4. Configure Gmail

- Google Cloud Console → enable the Gmail API → create an OAuth2 Client ID
  (Desktop or Web type) → add your own Google account as a **Test user**
  under the OAuth consent screen (Audience → Test users) so you don't hit
  the "Access blocked" error.
- Redirect URI: `http://localhost:5678/rest/oauth2-credential/callback`
- In n8n: Credentials → New → Gmail OAuth2 → name it exactly
  `Gmail OAuth2 - Recruitment Inbox` → paste Client ID/Secret → Connect.

### 5. Configure Google Calendar

- Same Google Cloud project → enable the Calendar API → new OAuth2 client
  (same redirect URI pattern).
- In n8n: Credentials → New → Google Calendar OAuth2 → authenticate.

### 6. Import the workflows

- n8n → Workflows → **Import from File** → `workflow/resume_screening_workflow.json`
- Import `workflow/error_handler_workflow.json` the same way, then in the
  main workflow's Settings, set **Error Workflow** to point at it.
- Re-select credentials on every node showing a red warning (Gmail Trigger,
  the three NocoDB nodes, Gmail send, Google Calendar) — credentials are
  never exported with secrets, by design.
- On each NocoDB node, update **Base Name or ID** and **Table Name or ID**
  to the IDs you noted in step 3.5.

### 7. Environment variables

Copy `.env.example` and export the values before starting n8n (or set them
as n8n Variables under Settings). See that file for the full list with
explanations.

### 8. Load the sample job description

`JD_FILE_PATH` should point at `sample-data/job_description.md`. To test
against a different role, just replace that file's contents — no workflow
changes needed.

### 9. Test end-to-end

Either send yourself a real email with subject like "Application for Backend
Engineer" and one of the `sample-data/` resumes attached, or use n8n's
"Test workflow" button to run the whole chain manually against a Gmail
message already sitting in the inbox. Watch the Executions tab; a NocoDB row
should appear, and for a high-scoring resume, an interview invitation email
+ calendar event should follow, with the NocoDB status updating to
`Interview Scheduled`.

---

## ⚙️ Shortlisting thresholds (Step 7)

| Match Score | Recommendation | Application Status  |
|-------------|-----------------|----------------------|
| ≥ 80        | Shortlist        | Shortlisted → Interview Scheduled |
| 60–79       | Manual Review    | Manual Review        |
| < 60        | Reject           | Rejected             |

These match the assignment's suggested defaults and are exposed as
`MATCH_SCORE_SHORTLIST_THRESHOLD` / `MATCH_SCORE_REVIEW_THRESHOLD` env vars
so they can be tuned per role without editing the workflow.

---

## 👤 Manual Recruiter Review (Step 9)

No custom UI was built for this — NocoDB's native grid/Kanban views satisfy
the requirement directly. Recruiters can open any candidate row and:

- review every AI-extracted field,
- edit any of them inline,
- override `Recommendation` / `ApplicationStatus`,
- add free-text notes in `RecruiterNotes`.

See `schema/nocodb_field_spec.md § Views` for a recommended Kanban-by-status
board that doubles as a lightweight recruiter dashboard.

---

## 🧾 Database Schema

Full spec in `schema/nocodb_field_spec.md`; summary below (31 fields total).

| Field | Description |
|---|---|
| CandidateName, Email, Phone, Location | Basic contact info |
| CurrentRole, CurrentCompany, ExperienceYears | Career snapshot |
| Education, TechnicalSkills, SoftSkills, Certifications, Languages, Projects | Resume detail (stored as comma-joined strings) |
| LinkedInUrl | If available |
| MatchScore, MatchingSkills, MissingSkills, RelevantExperience, PotentialConcerns, AISummary, AIRecommendationRaw | Step 4 — JD match output |
| Recommendation, ApplicationStatus | Official, rule-based (Step 7) |
| RecruiterNotes | Manual, human-entered |
| EmailSubject, SenderEmail, ReceivedAt | Original email metadata (Step 1) |
| ResumeAttachment | Original resume file |
| InterviewDateTime, CalendarEventId | Set once interview is scheduled (Step 8) |
| ResumeHash | SHA-256, used for duplicate detection (bonus) |

---

## 🧩 AI Prompts Used

Full prompt text and design rationale in `prompts/resume_parsing_prompt.md`
and `prompts/jd_matching_prompt.md`. Both are also embedded inline in the
corresponding n8n Code nodes ("Build Resume Parsing Prompt" / "Build JD
Match Prompt") so the workflow JSON is fully self-contained — the markdown
files exist for readability and as the source of truth to keep both copies
in sync.

**Resume parsing** returns candidate_name, email, phone, location,
total_experience_years, current_role, current_company, education,
technical_skills, soft_skills, certifications, languages, projects, and
linkedin_url as strict JSON, with explicit instructions to never invent data
and to always return flat string arrays (a real failure mode of
`llama3.2:3b` that the prompt and validation layer both guard against).

**JD matching** compares the parsed candidate profile against the active job
description and returns match_score (0–100, with an explicit weighted
rubric: 40 pts skills, 25 pts experience, 15 pts education/certs, 10 pts
seniority, 10 pts soft skills/domain), matching_skills, missing_skills,
relevant_experience, potential_concerns, ai_summary, and
hiring_recommendation.

## ✅ Bonus items implemented

- **Duplicate candidate detection** — SHA-256 resume-hash lookup before
  insert, with a dedicated `Determine Duplicate Status` node that correctly
  handles NocoDB's zero-result case (a common n8n pitfall where a node
  receiving 0 input items silently skips all downstream nodes).
- Retry-safe, defensive JSON parsing with graceful fallbacks at every LLM
  call.
- Error workflow with NocoDB logging + recruiter email alert.
- Deterministic, configurable shortlisting thresholds.
- Unit tests for the validation layer.

- Built by Vidhi Waghela
- (mail-id: vidhiwaghela99@gmail.com)
