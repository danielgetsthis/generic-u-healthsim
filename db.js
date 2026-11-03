import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On Vercel Serverless, /var/task is read-only; /tmp is writable
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const DATA_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'healthsim.sqlite');
const JSON_FALLBACK_PATH = path.join(DATA_DIR, 'healthsim-db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_CONFIG = {
  architectureMode: 'version-a', // 'version-a' | 'version-b'
  showAbBannerOnStudentReport: false,
  aiConfig: {
    provider: 'gemini',
    geminiModel: 'auto-fast',
    apiKey: process.env.GEMINI_API_KEY || '',
    typesafeApiKey: process.env.TYPESAFE_API_KEY || '',
    ttsRate: 1.0,
  },
};

// Try native node:sqlite (Node 22.5+), otherwise gracefully use JSON-backed store
let db = null;
try {
  const sqliteMod = await import('node:sqlite');
  if (sqliteMod?.DatabaseSync) {
    db = new sqliteMod.DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS custom_scenarios (
        id TEXT PRIMARY KEY,
        course_code TEXT NOT NULL,
        title TEXT NOT NULL,
        client_name TEXT NOT NULL,
        scenario_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        course_code TEXT NOT NULL,
        scenario_title TEXT NOT NULL,
        client_name TEXT NOT NULL,
        architecture_mode TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        turn_count INTEGER NOT NULL,
        final_rapport INTEGER NOT NULL,
        score_version_a INTEGER NOT NULL,
        score_version_b INTEGER NOT NULL,
        open_question_pct INTEGER NOT NULL,
        transcript_json TEXT NOT NULL,
        turn_jev_json TEXT NOT NULL,
        eval_a_json TEXT NOT NULL,
        eval_b_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
} catch {
  db = null;
}

function readJsonStore() {
  try {
    if (fs.existsSync(JSON_FALLBACK_PATH)) {
      return JSON.parse(fs.readFileSync(JSON_FALLBACK_PATH, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {
    config: DEFAULT_CONFIG,
    customScenarios: [],
    sessions: [],
  };
}

function writeJsonStore(store) {
  try {
    fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

export function getAppConfig() {
  if (!db) {
    const store = readJsonStore();
    return {
      ...DEFAULT_CONFIG,
      ...(store.config || {}),
      aiConfig: {
        ...DEFAULT_CONFIG.aiConfig,
        ...(store.config?.aiConfig || {}),
      },
    };
  }

  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get('app_config');
  if (!row) {
    saveAppConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const parsed = JSON.parse(row.value);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      aiConfig: {
        ...DEFAULT_CONFIG.aiConfig,
        ...(parsed.aiConfig || {}),
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveAppConfig(newConfig) {
  const current = getAppConfig();
  const merged = {
    ...DEFAULT_CONFIG,
    ...current,
    ...newConfig,
    aiConfig: {
      ...DEFAULT_CONFIG.aiConfig,
      ...(current.aiConfig || {}),
      ...(newConfig.aiConfig || {}),
    },
  };

  if (!db) {
    const store = readJsonStore();
    store.config = merged;
    writeJsonStore(store);
    return merged;
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  upsert.run('app_config', JSON.stringify(merged), new Date().toISOString());
  return merged;
}

export function listCustomScenarios() {
  if (!db) {
    return readJsonStore().customScenarios || [];
  }
  const stmt = db.prepare(
    'SELECT scenario_json FROM custom_scenarios ORDER BY created_at DESC'
  );
  const rows = stmt.all();
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.scenario_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function saveCustomScenario(scenario) {
  if (!db) {
    const store = readJsonStore();
    store.customScenarios = [
      scenario,
      ...(store.customScenarios || []).filter((s) => s.id !== scenario.id),
    ];
    writeJsonStore(store);
    return scenario;
  }

  const stmt = db.prepare(`
    INSERT INTO custom_scenarios (id, course_code, title, client_name, scenario_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      course_code = excluded.course_code,
      title = excluded.title,
      client_name = excluded.client_name,
      scenario_json = excluded.scenario_json
  `);
  stmt.run(
    scenario.id,
    scenario.courseCode || 'HEB Custom',
    scenario.title || 'Untitled Scenario',
    scenario.client?.name || 'Mock Client',
    JSON.stringify(scenario),
    new Date().toISOString()
  );
  return scenario;
}

export function deleteCustomScenario(id) {
  if (!db) {
    const store = readJsonStore();
    const before = (store.customScenarios || []).length;
    store.customScenarios = (store.customScenarios || []).filter(
      (s) => s.id !== id
    );
    writeJsonStore(store);
    return store.customScenarios.length < before;
  }
  const stmt = db.prepare('DELETE FROM custom_scenarios WHERE id = ?');
  const res = stmt.run(id);
  return res.changes > 0;
}

export function saveSessionRecord(record) {
  const id =
    record.id ||
    `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = record.createdAt || new Date().toISOString();

  if (!db) {
    const store = readJsonStore();
    const fullObj = {
      id,
      scenario_id: record.scenarioId || 'unknown',
      course_code: record.courseCode || 'HEB',
      scenario_title: record.scenarioTitle || 'Voice Session',
      client_name: record.clientName || 'Mock Client',
      architecture_mode: record.architectureMode || 'version-a',
      duration_seconds: Number(record.durationSeconds || 0),
      turn_count: Number(record.turnCount || 0),
      final_rapport: Number(record.finalRapport || 50),
      score_version_a: Number(record.scoreVersionA || 0),
      score_version_b: Number(record.scoreVersionB || 0),
      open_question_pct: Number(record.openQuestionPct || 0),
      transcript: record.transcript || [],
      turnJevHistory: record.turnJevHistory || [],
      evalVersionA: record.evalVersionA || {},
      evalVersionB: record.evalVersionB || {},
      created_at: createdAt,
    };
    store.sessions = [
      fullObj,
      ...(store.sessions || []).filter((s) => s.id !== id),
    ];
    writeJsonStore(store);
    return getSessionById(id);
  }

  const stmt = db.prepare(`
    INSERT INTO sessions (
      id, scenario_id, course_code, scenario_title, client_name,
      architecture_mode, duration_seconds, turn_count, final_rapport,
      score_version_a, score_version_b, open_question_pct,
      transcript_json, turn_jev_json, eval_a_json, eval_b_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  stmt.run(
    id,
    record.scenarioId || 'unknown',
    record.courseCode || 'HEB',
    record.scenarioTitle || 'Voice Session',
    record.clientName || 'Mock Client',
    record.architectureMode || 'version-a',
    Number(record.durationSeconds || 0),
    Number(record.turnCount || 0),
    Number(record.finalRapport || 50),
    Number(record.scoreVersionA || 0),
    Number(record.scoreVersionB || 0),
    Number(record.openQuestionPct || 0),
    JSON.stringify(record.transcript || []),
    JSON.stringify(record.turnJevHistory || []),
    JSON.stringify(record.evalVersionA || {}),
    JSON.stringify(record.evalVersionB || {}),
    createdAt
  );

  return getSessionById(id);
}

export function listSessions(limit = 100) {
  if (!db) {
    return (readJsonStore().sessions || []).slice(0, limit);
  }
  const stmt = db.prepare(`
    SELECT
      id, scenario_id, course_code, scenario_title, client_name,
      architecture_mode, duration_seconds, turn_count, final_rapport,
      score_version_a, score_version_b, open_question_pct, created_at
    FROM sessions
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export function getSessionById(id) {
  if (!db) {
    const row = (readJsonStore().sessions || []).find((s) => s.id === id);
    if (!row) return null;
    return {
      id: row.id,
      scenarioId: row.scenario_id,
      courseCode: row.course_code,
      scenarioTitle: row.scenario_title,
      clientName: row.client_name,
      architectureMode: row.architecture_mode,
      durationSeconds: row.duration_seconds,
      turnCount: row.turn_count,
      finalRapport: row.final_rapport,
      scoreVersionA: row.score_version_a,
      scoreVersionB: row.score_version_b,
      openQuestionPct: row.open_question_pct,
      transcript: row.transcript || [],
      turnJevHistory: row.turnJevHistory || [],
      evalVersionA: row.evalVersionA || {},
      evalVersionB: row.evalVersionB || {},
      createdAt: row.created_at,
    };
  }

  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    courseCode: row.course_code,
    scenarioTitle: row.scenario_title,
    clientName: row.client_name,
    architectureMode: row.architecture_mode,
    durationSeconds: row.duration_seconds,
    turnCount: row.turn_count,
    finalRapport: row.final_rapport,
    scoreVersionA: row.score_version_a,
    scoreVersionB: row.score_version_b,
    openQuestionPct: row.open_question_pct,
    transcript: JSON.parse(row.transcript_json || '[]'),
    turnJevHistory: JSON.parse(row.turn_jev_json || '[]'),
    evalVersionA: JSON.parse(row.eval_a_json || '{}'),
    evalVersionB: JSON.parse(row.eval_b_json || '{}'),
    createdAt: row.created_at,
  };
}

export function deleteSessionById(id) {
  if (!db) {
    const store = readJsonStore();
    const before = (store.sessions || []).length;
    store.sessions = (store.sessions || []).filter((s) => s.id !== id);
    writeJsonStore(store);
    return store.sessions.length < before;
  }
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const res = stmt.run(id);
  return res.changes > 0;
}

export function getDatabaseStats() {
  if (!db) {
    const store = readJsonStore();
    const sessions = store.sessions || [];
    const sessionCount = sessions.length;
    const customScenarioCount = (store.customScenarios || []).length;
    const avgA =
      sessionCount > 0
        ? Math.round(
            sessions.reduce((a, s) => a + (s.score_version_a || 0), 0) /
              sessionCount
          )
        : null;
    const avgB =
      sessionCount > 0
        ? Math.round(
            sessions.reduce((a, s) => a + (s.score_version_b || 0), 0) /
              sessionCount
          )
        : null;
    return {
      engine: 'JSON Store (Serverless)',
      dbPath: JSON_FALLBACK_PATH,
      sessionCount,
      customScenarioCount,
      avgScoreVersionA: avgA,
      avgScoreVersionB: avgB,
    };
  }

  const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
  const customScenarioCount = db
    .prepare('SELECT COUNT(*) as c FROM custom_scenarios')
    .get().c;
  const avgScores = db
    .prepare(
      'SELECT AVG(score_version_a) as avgA, AVG(score_version_b) as avgB FROM sessions'
    )
    .get();
  return {
    engine: 'SQLite (WAL)',
    dbPath: DB_PATH,
    sessionCount,
    customScenarioCount,
    avgScoreVersionA: avgScores?.avgA ? Math.round(avgScores.avgA) : null,
    avgScoreVersionB: avgScores?.avgB ? Math.round(avgScores.avgB) : null,
  };
}
