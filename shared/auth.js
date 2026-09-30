// shared/auth.js - 游客注册 / 登录业务
// 职责：注册时按用户名查重 + bcryptjs 哈希后写入 users 集合；登录时校验密码；
//       密码禁止明文存储、也禁止返回给前端。
const bcrypt = require('bcryptjs');
const { getUsers } = require('./db.js');

/** 重名提示：前后端保持同一句文案 */
const DUP_NAME_MSG = 'sorry啦，别人抢先一步注册改昵称了';

async function register(username, password) {
  const users = getUsers();

  const exists = await users.findOne({ username });
  if (exists) return { ok: false, error: DUP_NAME_MSG, duplicate: true };

  const hash = await bcrypt.hash(password, 10);
  try {
    await users.insertOne({ username, password: hash, createdAt: new Date() });
    return { ok: true, username };
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

  return { ok: true, username: found.username };
}

module.exports = { register, login, DUP_NAME_MSG };
