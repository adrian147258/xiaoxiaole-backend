// shared/auth.js - 游客注册 / 登录业务
// 职责：注册时按用户名查重 + bcryptjs 哈希后写入 users 集合；登录时校验密码；
//       成功时签发 HMAC token（存档接口靠它认身份）；密码禁止明文存储、也禁止返回给前端。
const bcrypt = require('bcryptjs');
const { getUsers } = require('./db.js');
const { signToken } = require('./token.js');

/**
 * 在成功响应上**追加** token / expiresAt（不改动任何既有字段，老前端忽略多余字段是安全的）。
 * 密钥没配置时 signToken 会抛错 → 由路由兜成 500。
 * 这是刻意的 fail fast：宁可注册失败让人类立刻去配 YOUXI_TOKEN_SECRET，
 * 也不要发一个空 token 让前端以为登录成功、结果存档接口全部 401。
 */
function withToken(payload) {
  const { token, expiresAt } = signToken(payload.username);
  return { ...payload, token, expiresAt };
}

/** 重名提示：前后端保持同一句文案 */
const DUP_NAME_MSG = 'sorry啦，别人抢先一步注册改昵称了';

/**
 * 密码规则：至少 8 位，且字母和数字都要有。
 * 前端也有一份同样的规则（只是提前挡一下、省一次往返），
 * 这里必须再校验一次 —— 否则绕过前端直接 POST 就能注册弱密码。
 */
const WEAK_PASS_MSG = '密码至少 8 位，而且要同时有字母和数字哦';

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return WEAK_PASS_MSG;
  if (!/[0-9]/.test(password)) return WEAK_PASS_MSG;
  if (!/[A-Za-z]/.test(password)) return WEAK_PASS_MSG;
  return null;
}

async function register(username, password) {
  // 弱密码直接拒绝（未通过则连查重都不必做）
  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak, weakPassword: true };

  const users = getUsers();

  const exists = await users.findOne({ username });
  if (exists) return { ok: false, error: DUP_NAME_MSG, duplicate: true };

  const hash = await bcrypt.hash(password, 10);
  try {
    await users.insertOne({ username, password: hash, createdAt: new Date() });
    return withToken({ ok: true, username });
  } catch (err) {
    // 唯一索引兜底：并发下重复注册
    if (err && err.code === 11000) return { ok: false, error: DUP_NAME_MSG, duplicate: true };
    throw err;
  }
}

/**
 * 登录：按用户名找人，再用 bcrypt 比对密码。
 * 用户不存在和密码错误返回同一句提示，避免泄露"这个用户名存在"。
 */
async function login(username, password) {
  const users = getUsers();
  const found = await users.findOne({ username });
  if (!found || !found.password) return { ok: false, error: '用户名或密码不对哦' };

  const matched = await bcrypt.compare(password, found.password);
  if (!matched) return { ok: false, error: '用户名或密码不对哦' };

  return withToken({ ok: true, username: found.username });
}

module.exports = { register, login, DUP_NAME_MSG };
