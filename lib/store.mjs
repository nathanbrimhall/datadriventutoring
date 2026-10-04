import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { id, token, hash, validateQuestion } from './domain.mjs';
import { seedQuestions } from './seed.mjs';
export function openStore(directory) {
  if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(directory === ':memory:' ? ':memory:' : join(directory, 'tutoring.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL, studentHash TEXT NOT NULL, parentHash TEXT NOT NULL, createdAt TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL, studentId TEXT REFERENCES students(id) ON DELETE CASCADE, expires INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, data TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, studentId TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, title TEXT NOT NULL, due TEXT NOT NULL, questions TEXT NOT NULL, createdAt TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS seen (studentId TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, questionId TEXT NOT NULL, PRIMARY KEY(studentId,questionId));',
    'CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, studentId TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, assignmentId TEXT REFERENCES assignments(id) ON DELETE CASCADE, question TEXT NOT NULL, guided INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, ticketId TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE, studentId TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, assignmentId TEXT REFERENCES assignments(id) ON DELETE CASCADE, questionId TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, correct INTEGER, seconds INTEGER NOT NULL, guided INTEGER NOT NULL, createdAt TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS reviews (attemptId TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE, feedback TEXT NOT NULL, source TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS attempts_student ON attempts(studentId,createdAt);',
    'CREATE TABLE IF NOT EXISTS generation_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL);',
  ].join('\n'));
  const getConfig = key => { const row = db.prepare('SELECT value FROM config WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; };
  const setConfig = (key,value) => db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  let bootstrapToken;
  if (!getConfig('adminHash')) { bootstrapToken = token(); setConfig('adminHash', hash(bootstrapToken)); }
  if (!getConfig('settings')) setConfig('settings', {
    name: 'ProgressPoint', tagline: 'Thoughtful practice. Measurable progress.',
    about: 'Learning is a process, not a score. ProgressPoint brings purposeful practice and clear progress into one calm workspace. Your tutor uses each question to understand what is clicking, what needs another look, and where to go next.',
    provider: 'openai', model: '', autoGenerate: false, autoGradeWriting: true, dailyLimit: 10,
    guidelines: 'Create accurate, age-appropriate math practice. Use clear language, one unambiguous answer, plausible distractors, and a concise explanation. Verify the answer independently. Avoid personal questions. Walkthrough steps should scaffold the method without revealing the final answer.',
  });
  const putQuestion = input => {
    const q = { ...validateQuestion(input), id: input.id || id(), source: input.source === 'ai' ? 'ai' : 'tutor', reviewed: input.reviewed !== false };
    db.prepare('INSERT INTO questions(id,data,createdAt) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(q.id,JSON.stringify(q),new Date().toISOString());
    return q;
  };
  if (!getConfig('seeded')) transaction(() => { seedQuestions().forEach(putQuestion); setConfig('seeded', true); });
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const questions = (includeArchived = false) => db.prepare('SELECT * FROM questions' + (includeArchived ? '' : ' WHERE archived=0') + ' ORDER BY createdAt DESC').all().map(row => ({...JSON.parse(row.data),archived:!!row.archived}));
  const students = () => db.prepare('SELECT id,name,createdAt FROM students ORDER BY createdAt DESC').all();
  const assignments = studentId => db.prepare('SELECT * FROM assignments' + (studentId ? ' WHERE studentId=?' : '') + ' ORDER BY createdAt DESC').all(...(studentId ? [studentId] : [])).map(a => ({...a,questions:JSON.parse(a.questions)}));
  const attempts = studentId => db.prepare('SELECT * FROM attempts' + (studentId ? ' WHERE studentId=?' : '') + ' ORDER BY createdAt').all(...(studentId ? [studentId] : [])).map(a => ({...a,question:JSON.parse(a.question),guided:!!a.guided,review:db.prepare('SELECT feedback,source FROM reviews WHERE attemptId=?').get(a.id)}));
  return { db, getConfig, setConfig, putQuestion, questions, students, assignments, attempts, transaction, bootstrapToken };
}
