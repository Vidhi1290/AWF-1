/**
 * validate.js
 *
 * Standalone Node.js implementation of the data validation / cleaning logic
 * used inside the n8n "Parse & Validate JSON Output" and "Parse Match Result"
 * Code nodes (Step 5 of the assignment). Kept as a separate module so it can
 * be:
 *   1. Unit tested outside of n8n (see scripts/validate.test.js)
 *   2. Copy-pasted into n8n Code nodes (n8n Code nodes cannot `require()`
 *      local files by default, so the workflow JSON embeds this same logic
 *      inline — this file is the source of truth / documentation copy).
 *
 * Run tests with: node scripts/validate.test.js
 */

'use strict';

/**
 * Extract the first valid JSON object from a raw LLM string response.
 * Local models (llama3.2, gpt-oss via Ollama) sometimes wrap JSON in
 * ```json fences or add a stray sentence before/after — this strips that.
 */
function safeExtractJSON(rawText) {
  if (rawText === null || rawText === undefined) return {};
  let text = String(rawText).trim();

  // Strip markdown code fences if present
  text = text.replace(/```json/gi, '```');
  const fenceMatch = text.match(/```([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Greedily find the outermost { ... } block
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return {};
  }
  const candidate = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(candidate);
  } catch (err) {
    // Last resort: try to fix trailing commas, a common local-model artifact
    try {
      const repaired = candidate.replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch (err2) {
      return { _parseError: true, _rawText: rawText };
    }
  }
}

/**
 * Coerce a single list item into a readable string. Local models sometimes
 * return structured objects inside what should be a flat list (e.g.
 * education: [{ degree: "...", institution: "...", year: "..." }] instead of
 * a plain string) — naively calling String() on an object yields the
 * useless "[object Object]", so we flatten objects/arrays into a readable
 * joined string instead.
 */
function stringifyListItem(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (Array.isArray(item)) {
    return item.map(stringifyListItem).filter(Boolean).join(', ');
  }
  if (typeof item === 'object') {
    return Object.values(item)
      .map(stringifyListItem)
      .filter(Boolean)
      .join(' - ');
  }
  return String(item).trim();
}

/** Deduplicate a list, case-insensitively, trimming whitespace, dropping empties. */
function dedupeList(list) {
  if (!Array.isArray(list)) {
    if (typeof list === 'string' && list.trim()) {
      // sometimes the model returns a comma-separated string instead of an array
      list = list.split(',');
    } else {
      return [];
    }
  }
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item === null || item === undefined) continue;
    const trimmed = stringifyListItem(item);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

/** Normalize a phone number to digits + optional leading "+". Returns '' if unrecoverable. */
function normalizePhone(phone) {
  if (!phone) return '';
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  // Require at least 7 digits to be considered a plausible phone number
  const digitCount = (cleaned.match(/\d/g) || []).length;
  if (digitCount < 7) return '';
  return cleaned;
}

/** Coerce experience into a rounded-to-1-decimal float years value. */
function standardizeExperience(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = parseFloat(String(value).replace(/[^\d.]/g, ''));
  if (Number.isNaN(num)) return 0;
  return Math.round(num * 10) / 10;
}

/**
 * Clean and validate a raw parsed resume object (output of the resume
 * parsing LLM call) against the candidate schema. Never throws — always
 * returns a fully-populated, safe object, filling gaps gracefully per the
 * assignment's Step 5 requirements.
 */
function validateResumeFields(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};

  const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
  const phone = normalizePhone(r.phone);

  return {
    candidate_name: (r.candidate_name || '').toString().trim() || 'Unknown Candidate',
    email: isValidEmail(email) ? email : '',
    email_is_valid: isValidEmail(email),
    phone: phone,
    phone_is_valid: phone !== '',
    location: (r.location || '').toString().trim(),
    total_experience_years: standardizeExperience(r.total_experience_years),
    current_role: (r.current_role || '').toString().trim(),
    current_company: (r.current_company || '').toString().trim(),
    education: dedupeList(r.education),
    technical_skills: dedupeList(r.technical_skills),
    soft_skills: dedupeList(r.soft_skills),
    certifications: dedupeList(r.certifications),
    languages: dedupeList(r.languages),
    projects: dedupeList(r.projects),
    linkedin_url: (r.linkedin_url || '').toString().trim(),
  };
}

/** Clean and validate the JD-matching LLM output. */
function validateMatchFields(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};

  let score = Number(r.match_score);
  if (Number.isNaN(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const allowedRecs = ['Shortlist', 'Manual Review', 'Reject'];
  let aiRec = (r.hiring_recommendation || '').toString().trim();
  if (!allowedRecs.includes(aiRec)) aiRec = 'Manual Review';

  return {
    match_score: score,
    matching_skills: dedupeList(r.matching_skills),
    missing_skills: dedupeList(r.missing_skills),
    relevant_experience: (r.relevant_experience || '').toString().trim(),
    potential_concerns: dedupeList(r.potential_concerns),
    ai_summary: (r.ai_summary || '').toString().trim(),
    ai_recommendation_raw: aiRec,
  };
}

/**
 * Deterministic business-rule shortlisting (Step 7). Kept independent of the
 * LLM's own opinion (ai_recommendation_raw) so the official decision is
 * auditable and doesn't drift with model behavior.
 *
 * Thresholds (see README for justification):
 *   score >= 80        -> Shortlist
 *   60 <= score < 80    -> Manual Review
 *   score < 60          -> Reject
 */
function computeOfficialRecommendation(matchScore, thresholds) {
  const t = thresholds || { shortlist: 80, review: 60 };
  if (matchScore >= t.shortlist) return 'Shortlist';
  if (matchScore >= t.review) return 'Manual Review';
  return 'Reject';
}

function applicationStatusForRecommendation(recommendation) {
  if (recommendation === 'Shortlist') return 'Shortlisted';
  if (recommendation === 'Manual Review') return 'Manual Review';
  return 'Rejected';
}

module.exports = {
  safeExtractJSON,
  dedupeList,
  stringifyListItem,
  isValidEmail,
  normalizePhone,
  standardizeExperience,
  validateResumeFields,
  validateMatchFields,
  computeOfficialRecommendation,
  applicationStatusForRecommendation,
};
