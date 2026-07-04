# NocoDB Table Spec — `Candidates`

Create a new NocoDB base called `Recruitment`, then a table called
`Candidates` with the fields below. Field types are NocoDB UI types (not raw
SQL types) so you can build the table by hand in the NocoDB UI, or import
`schema.sql` if you prefer to provision it via SQLite/Postgres directly and
let NocoDB attach to that DB as an external source.

| Field                 | NocoDB Type        | Notes |
|-----------------------|--------------------|-------|
| CandidateName         | Single line text   | |
| Email                 | Email              | built-in validation |
| Phone                 | Phone Number       | |
| Location              | Single line text   | |
| CurrentRole           | Single line text   | |
| CurrentCompany        | Single line text   | |
| ExperienceYears        | Decimal            | |
| Education             | Long text          | JSON-stringified array |
| TechnicalSkills        | Long text          | JSON-stringified array |
| SoftSkills            | Long text          | JSON-stringified array |
| Certifications        | Long text          | JSON-stringified array |
| Languages             | Long text          | JSON-stringified array |
| Projects              | Long text          | JSON-stringified array |
| LinkedInUrl           | URL                | |
| MatchScore            | Number             | 0–100 |
| MatchingSkills         | Long text          | JSON-stringified array |
| MissingSkills          | Long text          | JSON-stringified array |
| RelevantExperience     | Long text          | |
| PotentialConcerns      | Long text          | JSON-stringified array |
| AISummary             | Long text          | |
| AIRecommendationRaw    | Single select      | Shortlist / Manual Review / Reject (AI's opinion) |
| Recommendation        | Single select      | Shortlist / Manual Review / Reject (official, rule-based) |
| ApplicationStatus      | Single select      | New / Manual Review / Shortlisted / Interview Scheduled / Rejected / Hired / Withdrawn |
| RecruiterNotes         | Long text          | editable by recruiter |
| EmailSubject           | Single line text   | |
| SenderEmail           | Email              | |
| ReceivedAt            | Date/Time          | |
| ResumeAttachment       | Attachment         | original PDF/DOCX file |
| InterviewDateTime      | Date/Time          | set when status -> Interview Scheduled |
| CalendarEventId        | Single line text   | Google Calendar event id, for later updates/cancellation |
| ResumeHash            | Single line text   | sha256 of normalized text, used for duplicate detection |

## Views (recommended, not required by grader but improves UX)

- **Grid: All Candidates** — default.
- **Grid: Shortlisted Queue** — filter `Recommendation = Shortlist AND ApplicationStatus != Interview Scheduled`.
- **Grid: Needs Manual Review** — filter `Recommendation = Manual Review`.
- **Kanban: By Status** — grouped on `ApplicationStatus`, gives recruiters a
  drag-and-drop pipeline view and doubles as the "manual recruiter review" UI
  required in Step 9 (edit fields inline, override recommendation, change
  status, add notes — all native NocoDB grid/kanban capabilities, no custom
  UI needed).

## Auth for n8n → NocoDB

Generate a NocoDB API token (Account Settings → Tokens) and set it as
`NOCODB_API_TOKEN` in n8n credentials (NocoDB node, "NocoDB API Token" auth
type). No external API key/billing required — NocoDB is fully self-hosted.
