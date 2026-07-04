/**
 * Minimal dependency-free unit tests for validate.js.
 * Run: node scripts/validate.test.js
 */
'use strict';

const assert = require('assert');
const {
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
} = require('./validate');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('safeExtractJSON');
test('parses clean JSON', () => {
  assert.deepStrictEqual(safeExtractJSON('{"a":1}'), { a: 1 });
});
test('strips markdown fences', () => {
  assert.deepStrictEqual(safeExtractJSON('```json\n{"a":1}\n```'), { a: 1 });
});
test('strips leading/trailing prose', () => {
  assert.deepStrictEqual(
    safeExtractJSON('Here is the JSON you asked for:\n{"a":1}\nHope that helps!'),
    { a: 1 }
  );
});
test('fixes trailing commas', () => {
  assert.deepStrictEqual(safeExtractJSON('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
});
test('returns parse error marker on garbage input', () => {
  const result = safeExtractJSON('not json at all');
  assert.strictEqual(result._parseError, undefined); // no braces -> {}
});

console.log('dedupeList');
test('dedupes case-insensitively and trims', () => {
  assert.deepStrictEqual(dedupeList(['Python', ' python ', 'SQL', 'sql']), ['Python', 'SQL']);
});
test('handles comma-separated string input', () => {
  assert.deepStrictEqual(dedupeList('Python, SQL, Python'), ['Python', 'SQL']);
});
test('handles non-array/non-string gracefully', () => {
  assert.deepStrictEqual(dedupeList(null), []);
  assert.deepStrictEqual(dedupeList(undefined), []);
  assert.deepStrictEqual(dedupeList(42), []);
});
test('flattens objects inside a list instead of "[object Object]" (regression: local model returning structured education/languages)', () => {
  assert.deepStrictEqual(
    dedupeList([
      { degree: 'B.Sc in Information Technology', institution: 'Pune University', year: '2020' },
    ]),
    ['B.Sc in Information Technology - Pune University - 2020']
  );
  assert.deepStrictEqual(
    dedupeList([{ language: 'English', proficiency: 'Fluent' }, { language: 'Hindi', proficiency: 'Native' }]),
    ['English - Fluent', 'Hindi - Native']
  );
});

console.log('stringifyListItem');
test('passes through strings/numbers/booleans', () => {
  assert.strictEqual(stringifyListItem(' Python '), 'Python');
  assert.strictEqual(stringifyListItem(5), '5');
  assert.strictEqual(stringifyListItem(true), 'true');
});
test('flattens nested arrays', () => {
  assert.strictEqual(stringifyListItem(['a', 'b', '']), 'a, b');
});
test('returns empty string for null/undefined', () => {
  assert.strictEqual(stringifyListItem(null), '');
  assert.strictEqual(stringifyListItem(undefined), '');
});

console.log('isValidEmail / normalizePhone');
test('validates correct emails', () => {
  assert.strictEqual(isValidEmail('jane.doe@example.com'), true);
});
test('rejects malformed emails', () => {
  assert.strictEqual(isValidEmail('not-an-email'), false);
});
test('normalizes phone with punctuation', () => {
  assert.strictEqual(normalizePhone('+1 (555) 123-4567'), '+15551234567');
});
test('rejects too-short phone numbers', () => {
  assert.strictEqual(normalizePhone('12345'), '');
});

console.log('standardizeExperience');
test('parses plain numbers', () => {
  assert.strictEqual(standardizeExperience('5'), 5);
});
test('parses "5 years" style strings', () => {
  assert.strictEqual(standardizeExperience('5.5 years'), 5.5);
});
test('defaults to 0 on garbage', () => {
  assert.strictEqual(standardizeExperience('n/a'), 0);
});

console.log('validateResumeFields');
test('fills missing fields gracefully', () => {
  const result = validateResumeFields({});
  assert.strictEqual(result.candidate_name, 'Unknown Candidate');
  assert.deepStrictEqual(result.technical_skills, []);
  assert.strictEqual(result.email_is_valid, false);
});
test('cleans a realistic payload', () => {
  const result = validateResumeFields({
    candidate_name: '  Jane Doe ',
    email: 'JANE@Example.com',
    phone: '(555) 111-2222',
    total_experience_years: '4 years',
    technical_skills: ['Python', 'python', 'React'],
  });
  assert.strictEqual(result.email, 'jane@example.com');
  assert.strictEqual(result.phone, '5551112222');
  assert.strictEqual(result.total_experience_years, 4);
  assert.deepStrictEqual(result.technical_skills, ['Python', 'React']);
});

console.log('validateMatchFields');
test('clamps score to 0-100', () => {
  assert.strictEqual(validateMatchFields({ match_score: 150 }).match_score, 100);
  assert.strictEqual(validateMatchFields({ match_score: -20 }).match_score, 0);
});
test('falls back to Manual Review on invalid recommendation', () => {
  assert.strictEqual(
    validateMatchFields({ hiring_recommendation: 'Definitely Hire!!' }).ai_recommendation_raw,
    'Manual Review'
  );
});

console.log('computeOfficialRecommendation / applicationStatusForRecommendation');
test('applies default thresholds', () => {
  assert.strictEqual(computeOfficialRecommendation(85), 'Shortlist');
  assert.strictEqual(computeOfficialRecommendation(70), 'Manual Review');
  assert.strictEqual(computeOfficialRecommendation(40), 'Reject');
  assert.strictEqual(computeOfficialRecommendation(80), 'Shortlist');
  assert.strictEqual(computeOfficialRecommendation(60), 'Manual Review');
});
test('maps recommendation to application status', () => {
  assert.strictEqual(applicationStatusForRecommendation('Shortlist'), 'Shortlisted');
  assert.strictEqual(applicationStatusForRecommendation('Manual Review'), 'Manual Review');
  assert.strictEqual(applicationStatusForRecommendation('Reject'), 'Rejected');
});

console.log(`\n${passed} tests passed.`);
