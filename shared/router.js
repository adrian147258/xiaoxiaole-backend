// shared/router.js - 业务路由（本地 serve-local.js 与线上 EdgeOne 入口共用）
// 职责：解析标准 Request 的 URL 路径与 POST JSON body，路由到注册/健康检查逻辑；
//       返回标准 Response（含 CORS 头、Content-Type: application/json）。
const { ensureDb, isDbReady } = require('./db.js');
const { register, login } = require('./auth.js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleApiRequest(request) {
  const url = new URL(request.url);

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 健康检查
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(200, { ok: true });
  }

  // 游客注册
  if (url.pathname === '/api/register' && request.method === 'POST') {
    try {
      let body = {};
      try {
        body = await request.json();
      } catch {
        // 非 JSON body 按空对象处理，走参数校验文案
      }

      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!username) return json(400, { ok: false, error: '请输入用户名' });
      if (!password) return json(400, { ok: false, error: '请输入密码' });

      if (!isDbReady()) {
        const ready = await ensureDb();
        if (!ready) return json(500, { ok: false, error: '服务器开小差了，请稍后再试' });
      }

      const result = await register(username, password);
      if (result.ok) return json(200, { ok: true, username: result.username });
      return json(result.duplicate ? 409 : 400, { ok: false, error: result.error, duplicate: !!result.duplicate });
    } catch (err) {
      console.error('[router] register 异常:', err);
      return json(500, { ok: false, error: '服务器开小差了，请稍后再试' });
    }
  }

  // 游客登录：校验用户名 + 密码
  if (url.pathname === '/api/login' && request.method === 'POST') {
    try {
      let body = {};
      try {
        body = await request.json();
      } catch {
        // 非 JSON body 按空对象处理，走参数校验文案
      }

      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!username) return json(400, { ok: false, error: '请输入用户名' });
      if (!password) return json(400, { ok: false, error: '请输入密码' });

      if (!isDbReady()) {
        const ready = await ensureDb();
        if (!ready) return json(500, { ok: false, error: '服务器开小差了，请稍后再试' });
      }

      const result = await login(username, password);
      if (result.ok) return json(200, { ok: true, username: result.username });
      return json(401, { ok: false, error: result.error });
    } catch (err) {
      console.error('[router] login 异常:', err);
      return json(500, { ok: false, error: '服务器开小差了，请稍后再试' });
    }
  }

  return json(404, { ok: false, error: 'Not Found' });
}

module.exports = { handleApiRequest };
