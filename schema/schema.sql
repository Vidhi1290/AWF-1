-- ============================================================================
-- Candidate table schema for the AI Resume Screening & Interview Scheduling
-- workflow. NocoDB is deployed on top of its own backing database (SQLite by
-- default in Docker), so this DDL matches the table NocoDB will create — it
-- can also be run directly against Postgres/MySQL/SQLite if you choose to
-- self-host NocoDB against an external DB, or for local testing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS candidates (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT, -- NocoDB auto Id field
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Candidate identity (from AI resume parsing)
    candidate_name        TEXT,
    email                 TEXT,
    phone                 TEXT,
    location              TEXT,

    -- Professional profile
    current_role          TEXT,
    current_company       TEXT,
    experience_years       REAL,               -- total years of experience (numeric)
    education             TEXT,               -- JSON array stored as text (NocoDB: LongText)
    technical_skills       TEXT,               -- JSON array stored as text
    soft_skills           TEXT,               -- JSON array stored as text
    certifications        TEXT,               -- JSON array stored as text
    languages             TEXT,               -- JSON array stored as text
    projects              TEXT,               -- JSON array stored as text
    linkedin_url          TEXT,

    -- JD matching / AI evaluation (from JD matching step)
    match_score           INTEGER,             -- 0-100
    matching_skills        TEXT,               -- JSON array stored as text
    missing_skills         TEXT,               -- JSON array stored as text
    relevant_experience    TEXT,
    potential_concerns     TEXT,               -- JSON array stored as text
    ai_summary             TEXT,
    ai_recommendation_raw  TEXT,               -- AI's own opinion (Shortlist/Manual Review/Reject)

    -- Business logic (deterministic, computed by workflow, not by the LLM)
    recommendation         TEXT CHECK (recommendation IN ('Shortlist','Manual Review','Reject')),
    application_status     TEXT DEFAULT 'New' CHECK (
                                application_status IN (
                                    'New',
                                    'Manual Review',
                                    'Shortlisted',
                                    'Interview Scheduled',
                                    'Rejected',
                                    'Hired',
                                    'Withdrawn'
                                )
                            ),
    recruiter_notes        TEXT,

    -- Source email metadata (Step 1 requirement)
    email_subject          TEXT,
    sender_email           TEXT,
    received_at            TIMESTAMP,

    -- Attachment
    resume_attachment      TEXT,               -- NocoDB Attachment field (stores file object/URL)

    -- Interview scheduling (Step 8)
    interview_datetime     TIMESTAMP,
    calendar_event_id      TEXT,

    -- Duplicate detection (bonus)
    resume_hash            TEXT                -- sha256 of normalized resume text, for dedup lookups
);

CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(application_status);
CREATE INDEX IF NOT EXISTS idx_candidates_resume_hash ON candidates(resume_hash);

-- ============================================================================
-- Optional: error/audit log table (bonus - logging & monitoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_error_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    workflow_name   TEXT,
    node_name       TEXT,
    email_subject   TEXT,
    sender_email    TEXT,
    error_message   TEXT,
    raw_payload     TEXT
);
