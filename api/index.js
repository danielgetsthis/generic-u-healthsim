import {
  getAppConfig,
  saveAppConfig,
  listCustomScenarios,
  saveCustomScenario,
  deleteCustomScenario,
  saveSessionRecord,
  listSessions,
  getSessionById,
  deleteSessionById,
  getDatabaseStats,
} from '../db.js';

function readJsonBody(req) {
  // Vercel sometimes pre-parses req.body
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export default async function apiHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  if (!pathname.startsWith('/api')) {
    pathname = '/api' + (pathname.startsWith('/') ? pathname : '/' + pathname);
  }
  const method = req.method || 'GET';

  try {
    // 1. Health & status
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'Generic U HealthSim Studio - HHP (HEB)',
        stats: getDatabaseStats(),
      });
    }

    // 2. App state (config + custom scenarios + stats)
    if (pathname === '/api/state' && method === 'GET') {
      return sendJson(res, 200, {
        config: getAppConfig(),
        customScenarios: listCustomScenarios(),
        stats: getDatabaseStats(),
      });
    }

    // 3. Update global admin configuration
    if (pathname === '/api/config' && (method === 'PUT' || method === 'POST')) {
      const body = await readJsonBody(req);
      const updated = saveAppConfig(body);
      return sendJson(res, 200, {
        ok: true,
        config: updated,
        stats: getDatabaseStats(),
      });
    }

    // 4. Custom scenarios CRUD
    if (pathname === '/api/scenarios' && method === 'GET') {
      return sendJson(res, 200, {
        customScenarios: listCustomScenarios(),
      });
    }

    if (pathname === '/api/scenarios' && method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveCustomScenario(body);
      return sendJson(res, 201, {
        ok: true,
        scenario: saved,
        customScenarios: listCustomScenarios(),
      });
    }

    if (pathname.startsWith('/api/scenarios/') && method === 'DELETE') {
      const id = decodeURIComponent(pathname.replace('/api/scenarios/', ''));
      const deleted = deleteCustomScenario(id);
      return sendJson(res, 200, {
        ok: deleted,
        customScenarios: listCustomScenarios(),
      });
    }

    // 5. Sessions & evaluation records CRUD
    if (pathname === '/api/sessions' && method === 'GET') {
      return sendJson(res, 200, {
        sessions: listSessions(100),
        stats: getDatabaseStats(),
      });
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveSessionRecord(body);
      return sendJson(res, 201, {
        ok: true,
        session: saved,
      });
    }

    if (pathname.startsWith('/api/sessions/') && method === 'GET') {
      const id = decodeURIComponent(pathname.replace('/api/sessions/', ''));
      const session = getSessionById(id);
      if (!session) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, { session });
    }

    if (pathname.startsWith('/api/sessions/') && method === 'DELETE') {
      const id = decodeURIComponent(pathname.replace('/api/sessions/', ''));
      const deleted = deleteSessionById(id);
      return sendJson(res, 200, {
        ok: deleted,
        sessions: listSessions(100),
        stats: getDatabaseStats(),
      });
    }

    return sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
}
