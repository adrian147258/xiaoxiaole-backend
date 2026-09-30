// shared/auth.js - 游客注册业务
// 职责：按用户名查重 + bcryptjs 哈希后写入 users 集合；密码禁止明文存储。
const bcrypt = require('bcryptjs');
const { getUsers } = require('./db.js');

async function register(username, password) {
  const users = getUsers();

  const exists = await users.findOne({ username });
  if (exists) return { ok: false, error: '该用户名已被使用' };

  const hash = await bcrypt.hash(password, 10);
  try {
    await users.insertOne({ username, password: hash, createdAt: new Date() });
    return { ok: true, username };
  } catch (err) {
    // 唯一索引兜底：并发下重复注册
    if (err && err.code === 11000) return { ok: false, error: '该用户名已被使用' };
    throw err;
  }
}

module.exports = { register };
