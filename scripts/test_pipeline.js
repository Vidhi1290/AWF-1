#!/usr/bin/env node
/**
 * test_pipeline.js
 *
 * Runs the EXACT same logic as the n8n workflow (extraction -> Ollama resume
 * parsing -> validation -> Ollama JD matching -> validation -> shortlisting)
 * end-to-end on your own machine, against your locally running Ollama.
 *
 * This lets you verify the AI parsing/scoring works correctly BEFORE wiring
 * up n8n/NocoDB/Gmail — useful for debugging and for a quick sanity check
 * while preparing the demo recording.
 *
 * Usage:
 *   cd scripts
 *   npm install                     # first time only
 *   node test_pipeline.js ../sample-data/resume_strong_match_priya_sharma.docx
 *   node test_pipeline.js ../sample-data/resume_medium_match_arjun_verma.docx
 *   node test_pipeline.js ../sample-data/resume_weak_match_neha_kapoor.pdf
 *
 * Env vars (all optional, sensible defaults):
 *   OLLAMA_BASE_URL   default http://localhost:11434
 *   OLLAMA_MODEL      default llama3.2:3b
 *   JD_FILE_PATH      default ../sample-data/job_description.md
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  safeExtractJSON,
  validateResumeFields,
  validateMatchFields,
  computeOfficialRecommendation,
  applicationStatusForRecommendation,
} = require('./validate');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const JD_FILE_PATH = process.env.JD_FILE_PATH || path.join(__dirname, '..', 'sample-data', 'job_description.md');
const SHORTLIST_THRESHOLD = Number(process.env.MATCH_SCORE_SHORTLIST_THRESHOLD || 80);
const REVIEW_THRESHOLD = Number(process.env.MATCH_SCORE_REVIEW_THRESHOLD || 60);

async function fetchCompat(url, options) {
  if (typeof fetch === 'function') return fetch(url, options); // Node 18+
  const nodeFetch = require('node-fetch');
  return nodeFetch(url, options);
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error(`Unsupported file type: ${ext}. Only .pdf and .docx are supported.`);
}

async function callOllama(prompt) {
  const res = await fetchCompat(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      format: 'json',
      stream: false,
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.response;
}

function buildResumeParsingPrompt(resumeText) {
  const schema = `{
  "candidate_name": "",
  "email": "",
  "phone": "",
  "location": "",
  "total_experience_years": 0,
  "current_role": "",
  "current_company": "",
  "education": [],
  "technical_skills": [],
  "soft_skills": [],
  "certifications": [],
  "languages": [],
  "projects": [],
  "linkedin_url": ""
}`;
  return `You are a strict resume parsing engine used in a production HR pipeline.
Your ONLY job is to read the resume text below and return a single valid JSON
object with the exact schema described. Do not include any commentary,
markdown formatting, or code fences - output raw JSON only.

Rules:
- If a field is not present in the resume, return an empty string for string
  fields or an empty array for list fields. Never invent data.
- total_experience_years must be a number. Estimate from job date ranges if
  not stated explicitly; return 0 if impossible to determine.
- Deduplicate any list before returning it.
- Every list field (education, technical_skills, soft_skills, certifications,
  languages, projects) MUST be an array of plain strings, never an array of
  objects. E.g. education: ["B.Tech in Computer Science, VIT Vellore (2016-2020)"].
- Normalize phone numbers to digits and '+' only.
- Normalize email to lowercase.
- current_role and current_company must reflect the most recent listed position only.

Return JSON matching exactly this schema:
${schema}

Resume text:
"""
${resumeText}
"""`;
}

function buildJDMatchPrompt(candidate, jdText) {
  const schema = `{
  "match_score": 0,
  "matching_skills": [],
  "missing_skills": [],
  "relevant_experience": "",
  "potential_concerns": [],
  "ai_summary": "",
  "hiring_recommendation": ""
}`;
  const candidateJson = JSON.stringify(
    {
      candidate_name: candidate.candidate_name,
      total_experience_years: candidate.total_experience_years,
      current_role: candidate.current_role,
      current_company: candidate.current_company,
      education: candidate.education,
      technical_skills: candidate.technical_skills,
      soft_skills: candidate.soft_skills,
      certifications: candidate.certifications,
      projects: candidate.projects,
    },
    null,
    2
  );
  return `You are a senior technical recruiter AI. Compare the CANDIDATE_PROFILE JSON
against the JOB_DESCRIPTION text and produce a rigorous, evidence-based
evaluation. Only count a skill as matching if it is explicitly present in the
candidate profile. Do not invent experience the candidate does not have.

Output raw JSON only, matching exactly this schema:
${schema}

Scoring rubric for match_score (0-100 integer): 40 pts technical skill overlap,
25 pts relevant years of experience, 15 pts education/certification alignment,
10 pts role/title seniority alignment, 10 pts soft skills/domain relevance.

hiring_recommendation must be exactly one of: "Shortlist", "Manual Review", "Reject".
potential_concerns should flag gaps, over/under-qualification, job-hopping, etc. Return [] if none.

CANDIDATE_PROFILE:
${candidateJson}

JOB_DESCRIPTION:
"""
${jdText}
"""`;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node test_pipeline.js <path-to-resume.pdf|.docx>');
    process.exit(1);
  }
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(JD_FILE_PATH)) {
    console.error(`Job description file not found: ${JD_FILE_PATH}`);
    process.exit(1);
  }

  console.log(`\n=== 1. Extracting text from ${path.basename(resolvedPath)} ===`);
  const resumeText = await extractText(resolvedPath);
  console.log(`Extracted ${resumeText.length} characters.`);
  if (!resumeText.trim()) {
    console.error('ERROR: no text extracted - aborting (this is the "Guard: Extraction Succeeded" case in n8n).');
    process.exit(1);
  }

  console.log(`\n=== 2. Calling Ollama (${OLLAMA_MODEL}) to parse resume ===`);
  const resumeRaw = await callOllama(buildResumeParsingPrompt(resumeText));
  const resumeParsed = safeExtractJSON(resumeRaw);
  const candidate = validateResumeFields(resumeParsed);
  console.log(JSON.stringify(candidate, null, 2));

  console.log(`\n=== 3. Calling Ollama (${OLLAMA_MODEL}) to match against JD ===`);
  const jdText = fs.readFileSync(JD_FILE_PATH, 'utf-8');
  const matchRaw = await callOllama(buildJDMatchPrompt(candidate, jdText));
  const matchParsed = safeExtractJSON(matchRaw);
  const match = validateMatchFields(matchParsed);
  console.log(JSON.stringify(match, null, 2));

  console.log('\n=== 4. Shortlisting Logic ===');
  const recommendation = computeOfficialRecommendation(match.match_score, {
    shortlist: SHORTLIST_THRESHOLD,
    review: REVIEW_THRESHOLD,
  });
  const applicationStatus = applicationStatusForRecommendation(recommendation);
  console.log(`Match Score: ${match.match_score}/100`);
  console.log(`Official Recommendation: ${recommendation}`);
  console.log(`Application Status: ${applicationStatus}`);

  console.log('\n=== Final candidate record (this is what gets written to NocoDB) ===');
  console.log(
    JSON.stringify(
      {
        ...candidate,
        ...match,
        recommendation,
        application_status: applicationStatus,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('\nPIPELINE FAILED:', err.message);
  process.exit(1);
});
