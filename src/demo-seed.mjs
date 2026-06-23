import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  importAnnotationData,
  openDb,
  upsertDaily,
  upsertSession
} from './db.mjs';

export function seedDemoDatabase({
  dbPath = resolve(process.cwd(), 'data', 'demo.sqlite'),
  demoPath = resolve(process.cwd(), 'docs', 'demo-data', 'token-work-demo.json')
} = {}) {
  const payload = JSON.parse(readFileSync(demoPath, 'utf8'));
  if (!payload.synthetic) {
    throw new Error('Demo seed refused non-synthetic data');
  }
  const db = openDb(dbPath);
  const daily = payload.usageSeed?.daily || [];
  const sessions = payload.usageSeed?.sessions || [];
  db.exec('BEGIN');
  try {
    for (const row of daily) upsertDaily(db, row);
    for (const row of sessions) upsertSession(db, row);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const imported = importAnnotationData(db, payload.annotationBackup || {});
  db.close();
  return {
    dbPath,
    daily: daily.length,
    sessions: sessions.length,
    imported
  };
}
