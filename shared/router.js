// shared/router.js - 业务路由（本地 serve-local.js 与线上 EdgeOne 入口共用）
// 职责：解析标准 Request 的 URL 路径与 JSON body，路由到健康检查 / 注册 / 登录 / 进度存档；
//       返回标准 Response（含 CORS 头、Content-Type: application/json）。
//
// 注意：线上云函数用的是 **Web 标准 Request/Response**（不是 event/body 那套），
// 所以取头一律用 request.headers.get(...)，取 body 用 request.text() / request.json()。
const { ensureDb, isDbReady, getProgress } = require('./db.js');
const { register, login } = require('./auth.js');
const { verifyToken, bearerFromRequest, isTokenReady } = require('./token.js');
const {
  sanitizeProgress,
  loadProgress,
  saveProgress,
  MAX_BODY_BYTES,
} = require('./progress.js');

const SERVER_ERR = '服务器开小差了，请稍后再试';
const AUTH_EXPIRED = '登录已过期，请重新登录';
const BAD_PROGRESS = '进度数据不合法';

/**
 * 允许的来源。默认回退 '*'（历史行为不变）。
 * 若配置了 YOUXI_ALLOWED_ORIGINS（逗号分隔），则按白名单精确回显。
 * 说明：用 Bearer token 而不是 Cookie，所以 '*' 不构成 CSRF 风险；
 * 白名单是更严格的可选项，不配置也不会把前端卡死。
 */
const ALLOWED_ORIGINS = (process.env.YOUXI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get('origin')) || '';
  let allow = '*';
  if (ALLOWED_ORIGINS.length > 0) {
    allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // Authorization 必须在这里，否则带 token 的跨域请求连预检都过不了
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * 读 JSON body，带体积上限。
 * 非 JSON / 空 body → 返回 {}（沿用原有行为：走参数校验文案）
 * 超过上限 → tooLarge: true（存档接口据此回 400）
 */
async function readJsonBody(request, maxBytes) {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return { value: {} };
  }
  if (raw.length > maxBytes) return { tooLarge: true, value: {} };
  if (!raw) return { value: {} };
  try {
    const parsed = JSON.parse(raw);
    return { value: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch {
    return { value: {} };
  }
}

async function ensureDbOr500(request) {
  if (isDbReady()) return null;
  const ready = await ensureDb();
  if (!ready) return json(request, 500, { ok: false, error: SERVER_ERR });
  return null;
}

/** 校验 token 并返回用户名；失败直接返回 401 Response，调用方判 instanceof */
function requireUser(request) {
  if (!isTokenReady()) {
    // 没配密钥时 verifyToken 一律失败，直接回 500 并把原因写清楚，免得被误诊成「token 过期」
    console.error('[router] YOUXI_TOKEN_SECRET 未配置，存档接口不可用');
    return json(request, 500, { ok: false, error: SERVER_ERR });
  }
  const username = verifyToken(bearerFromRequest(request));
  if (!username) return json(request, 401, { ok: false, error: AUTH_EXPIRED });
  return username;
}

async function handleApiRequest(request) {
  const url = new URL(request.url);

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // 健康检查（附带令牌配置状态，方便部署后自检）
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(request, 200, { ok: true, tokenReady: isTokenReady() });
  }

  // 游客注册
  if (url.pathname === '/api/register' && request.method === 'POST') {
    try {
      const { value: body } = await readJsonBody(request, MAX_BODY_BYTES);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!username) return json(request, 400, { ok: false, error: '请输入用户名' });
      if (!password) return json(request, 400, { ok: false, error: '请输入密码' });

      const dbErr = await ensureDbOr500(request);
      if (dbErr) return dbErr;

      const result = await register(username, password);
      if (result.ok) {
        // 只追加 token / expiresAt，原有字段一个不动
        return json(request, 200, {
          ok: true,
          username: result.username,
          token: result.token,
          expiresAt: result.expiresAt,
        });
      }
      return json(request, result.duplicate ? 409 : 400, {
        ok: false,
        error: result.error,
        duplicate: !!result.duplicate,
      });
    } catch (err) {
      // 没配 YOUXI_TOKEN_SECRET 会在这里被兜住：注册直接失败（fail fast，见方案第 6.3 节）
      console.error('[router] register 异常:', err && err.message ? err.message : err);
      return json(request, 500, { ok: false, error: SERVER_ERR });
    }
  }

  // 游客登录：校验用户名 + 密码
  if (url.pathname === '/api/login' && request.method === 'POST') {
    try {
      const { value: body } = await readJsonBody(request, MAX_BODY_BYTES);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!username) return json(request, 400, { ok: false, error: '请输入用户名' });
      if (!password) return json(request, 400, { ok: false, error: '请输入密码' });

      const dbErr = await ensureDbOr500(request);
      if (dbErr) return dbErr;

      const result = await login(username, password);
      if (result.ok) {
        return json(request, 200, {
          ok: true,
          username: result.username,
          token: result.token,
          expiresAt: result.expiresAt,
        });
      }
      return json(request, 401, { ok: false, error: result.error });
    } catch (err) {
      console.error('[router] login 异常:', err && err.message ? err.message : err);
      return json(request, 500, { ok: false, error: SERVER_ERR });
    }
  }

  // ---- 进度存档：读取 ----
  // 身份只认 token 里的用户名；body / query / header 里的 username 一律忽略
  if (url.pathname === '/api/progress' && request.method === 'GET') {
    const who = requireUser(request);
    if (typeof who !== 'string') return who;
    try {
      const dbErr = await ensureDbOr500(request);
      if (dbErr) return dbErr;
      const progress = await loadProgress(getProgress(), who);
      return json(request, 200, { ok: true, progress });
    } catch (err) {
      console.error('[router] 读存档异常:', err && err.message ? err.message : err);
      return json(request, 500, { ok: false, error: SERVER_ERR });
    }
  }

  // ---- 进度存档：写入（原子 $max 合并，只增不减）----
  if (url.pathname === '/api/progress' && request.method === 'POST') {
    const who = requireUser(request);
    if (typeof who !== 'string') return who;
    try {
      const parsed = await readJsonBody(request, MAX_BODY_BYTES);
      if (parsed.tooLarge) return json(request, 400, { ok: false, error: BAD_PROGRESS });

      const clean = sanitizeProgress(parsed.value && parsed.value.progress);
      if (!clean) return json(request, 400, { ok: false, error: BAD_PROGRESS });

      const dbErr = await ensureDbOr500(request);
      if (dbErr) return dbErr;

      const progress = await saveProgress(getProgress(), who, clean);
      return json(request, 200, { ok: true, progress });
    } catch (err) {
      console.error('[router] 写存档异常:', err && err.message ? err.message : err);
      return json(request, 500, { ok: false, error: SERVER_ERR });
    }
  }

  return json(request, 404, { ok: false, error: 'Not Found' });
}

module.exports = { handleApiRequest };
