import { randomBytes, createHash, randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const check = (condition, message, status = 400) => { if (!condition) fail(status, message); };
export function text(value, label, max = 4000, optional = false) {
  check(typeof value === 'string', label + ' must be text.');
  const result = value.trim();
  check((optional || result.length > 0) && result.length <= max, label + ' is missing or too long.');
  return result;
}
export function tags(value, label) {
  check(Array.isArray(value) && value.length <= 20, label + ' must contain up to 20 tags.');
  return [...new Set(value.map(v => text(v, label, 60)))];
}
export const TYPES = ['multiple-choice', 'short-response', 'written-response'];
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'];
export function validateQuestion(input) {
  check(input && typeof input === 'object', 'A question is required.');
  check(Array.isArray(input.steps ?? []), 'Steps must be a list.');
  const q = {
    prompt: text(input.prompt, 'Question', 4000),
    topics: tags(input.topics, 'Topics'),
    courses: tags(input.courses, 'Courses'),
    type: input.type,
    mathMatch: input.mathMatch === 'exact' ? 'exact' : 'equivalent',
    difficulty: input.difficulty,
    choices: tags(input.choices ?? [], 'Choices'),
    answer: text(input.answer ?? '', 'Answer', 2000, false),
    alternatives: tags(input.alternatives ?? [], 'Accepted answers'),
    explanation: text(input.explanation ?? '', 'Explanation', 6000, true),
    steps: (input.steps ?? []).map(s => text(s, 'Step', 1000)),
    tolerance: Number(input.tolerance ?? 0),
  };
  check(q.topics.length > 0, 'Add at least one topic.');
  check(TYPES.includes(q.type), 'Choose a supported answer format.');
  check(DIFFICULTIES.includes(q.difficulty), 'Choose a supported difficulty.');
  check(Array.isArray(input.steps ?? []) && q.steps.length <= 12, 'Use up to 12 walkthrough steps.');
  check(Number.isFinite(q.tolerance) && q.tolerance >= 0 && q.tolerance <= 1, 'Numeric tolerance must be between 0 and 1.');
  if (q.type === 'multiple-choice') {
    check(q.choices.length >= 2 && q.choices.length <= 6, 'Use 2–6 unique choices.');
    check(q.choices.includes(q.answer), 'The correct answer must exactly match a choice.');
  } else q.choices = [];
  return q;
}
const normalize = value => String(value).replace(/²/g,'^2').replace(/³/g,'^3').normalize('NFKC').replace(/[−–]/g, '-').replace(/\s+/g, '').trim();
function number(value) {
  const s = normalize(value).replace(/,/g, '');
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return Number(s);
  if (/^[+-]?\d+\/[+-]?\d+$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    if (b !== 0) return a / b;
  }
  return NaN;
}
export function grade(question, answer) {
  if (question.type === 'written-response') return null;
  if (question.type === 'multiple-choice') return answer === question.answer ? 1 : 0;
  const expected = [question.answer, ...question.alternatives];
  if (expected.some(a => normalize(a) === normalize(answer))) return 1;
  const actual = number(answer);
  return Number.isFinite(actual) && expected.some(a => {
    const n = number(a);
    return Number.isFinite(n) && Math.abs(actual - n) <= Math.max(question.tolerance, Number.EPSILON * 8 * Math.max(1, Math.abs(n)));
  }) ? 1 : 0;
}
export function publicQuestion(q, guided = false) {
  const { answer, alternatives, explanation, steps, tolerance, ...rest } = q;
  return { ...rest, steps: guided ? steps : [], hasSteps: !!steps?.length };
}
export function matches(q, f = {}) {
  return (!f.topic || q.topics.includes(f.topic))
    && (!f.course || q.courses.includes(f.course))
    && (!f.type || q.type === f.type)
    && (!f.difficulty || q.difficulty === f.difficulty)
    && (!f.guided || q.steps.length > 0)
    && (!f.search || [q.prompt, ...q.topics, ...q.courses].join(' ').toLowerCase().includes(f.search.toLowerCase()));
}
export function summarize(attempts, days = 30, firstOnly = false) {
  const cutoff = new Date(); cutoff.setUTCHours(0, 0, 0, 0); cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  const seen = new Set();
  const selected = attempts.sort((a,b) => a.createdAt.localeCompare(b.createdAt)).filter(a => {
    const key = a.studentId + ':' + a.questionId;
    const first = !seen.has(key); seen.add(key);
    return a.createdAt >= cutoff.toISOString() && (!firstOnly || (first && !a.guided));
  });
  const metrics = list => {
    const graded = list.filter(a => a.correct !== null);
    return { attempts: list.length, graded: graded.length, pending: list.length - graded.length,
      correct: graded.filter(a => a.correct === 1).length,
      accuracy: graded.length ? Math.round(graded.reduce((n,a) => n + a.correct, 0) / graded.length * 100) : null,
      minutes: Math.round(list.reduce((n,a) => n + a.seconds, 0) / 60),
      guided: list.filter(a => a.guided).length };
  };
  const groups = new Map();
  for (const a of selected) for (const [kind, values] of [['Topic', a.question.topics], ['Course', a.question.courses], ['Difficulty', [a.question.difficulty]], ['Format', [a.question.type]]]) {
    for (const label of values) { const key = kind + ':' + label; if (!groups.has(key)) groups.set(key, {kind, label, rows: []}); groups.get(key).rows.push(a); }
  }
  const series = [];
  for (let i=0; i<days; i++) {
    const date = new Date(cutoff); date.setUTCDate(date.getUTCDate() + i);
    const day = date.toISOString().slice(0,10);
    series.push({ day, ...metrics(selected.filter(a => a.createdAt.startsWith(day))) });
  }
  return { ...metrics(selected), series,
    tags: [...groups.values()].map(g => ({kind:g.kind,label:g.label,...metrics(g.rows)})).sort((a,b) => (a.accuracy ?? 101) - (b.accuracy ?? 101)),
    recent: selected.slice(-20).reverse() };
}
