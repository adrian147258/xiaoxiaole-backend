// shared/token.js - HMAC 无状态令牌
// 职责：登录/注册成功时签发 token；存档接口校验 token 并取出用户名。
// 设计：不存库、无状态、不可单方面吊销，有效期 30 天。
// 安全：密钥只从环境变量 YOUXI_TOKEN_SECRET 读，绝不写默认值兜底（见 getSecret）。
'use strict';

const crypto = require('crypto');

/** 令牌有效期：30 天 */
const TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * 取签名密钥。
 * 没有配置就抛错 —— 绝不回退到某个内置字符串：那样任何人都能自己签发 token，
 * 整套鉴权等于没有。宁可让接口 500 也不能默默放行。
 */
function getSecret() {
  const s = process.env.YOUXI_TOKEN_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('YOUXI_TOKEN_SECRET 未配置或过短（至少 16 字符）');
  }
  return String(s);
}

/** 密钥是否已就绪（给健康检查用，不抛错） */
function isTokenReady() {
  const s = process.env.YOUXI_TOKEN_SECRET;
  return !!(s && String(s).length >= 16);
}

/**
 * 签发令牌：token = base64url(payload) + '.' + base64url(HMAC_SHA256(base64url(payload), SECRET))
 * 注意 HMAC 的输入是 base64url 之后的字符串（即第一段），签发与校验必须一致。
 */
function signToken(username) {
  const exp = Date.now() + TTL_MS;
  const body = Buffer.from(JSON.stringify({ u: String(username), exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: exp };
}

/**
 * 校验令牌，成功返回用户名，失败一律返回 null。
 * 不区分「格式错 / 过期 / 伪造」，减少信息泄露。
 */
function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    if (!body || !sig) return null;

    const expect = crypto.createHmac('sha256', getSecret()).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(got, expect)) return null; // 防时序攻击

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.u !== 'string' || !payload.u) return null;
    if (!payload.exp || Date.now() > Number(payload.exp)) return null;
    return payload.u;
  } catch {
    return null; // 任何解析异常都视为无效
  }
}

/** 从 Authorization 头字符串里取 Bearer 值（纯函数，便于单测） */
function bearerFromHeaderValue(raw) {
  const m = String(raw || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/**
 * 从标准 Request 取 token。
 * 线上云函数用的是 Web 标准 Request/Response（不是 event/headers 那套），
 * EdgeOne 的头名大小写不保证，所以用 Headers.get（本来就大小写不敏感）。
 */
function bearerFromRequest(request) {
  if (!request || !request.headers || typeof request.headers.get !== 'function') return '';
  return bearerFromHeaderValue(request.headers.get('authorization'));
}

module.exports = {
  TTL_MS,
  getSecret,
  isTokenReady,
  signToken,
  verifyToken,
  bearerFromHeaderValue,
  bearerFromRequest,
};
