// shared/db.js - MongoDB 连接管理（原生 mongodb 驱动）
// 职责：读取 process.env.MONGODB_URI 延迟连接 MongoDB；提供 users 集合访问与用户名唯一索引保证。
// 设计：启动不阻塞；首次业务请求触发连接；连接失败只记日志，接口返回兜底错误，进程不崩溃。
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = 'youxi';

let client = null;
let db = null;
let connecting = null;

function isDbReady() {
  return db !== null;
}

async function ensureDb() {
  if (!MONGODB_URI) {
    console.warn('[db] 未配置 MONGODB_URI，数据库功能不可用');
    return false;
  }
  if (db) return true;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await c.connect();
      const d = c.db(DB_NAME);
      // 用户名唯一索引：并发/重复注册兜底（createIndex 幂等，重复执行不报错）
      await d.collection('users').createIndex({ username: 1 }, { unique: true });
      client = c;
      db = d;
      console.log('[db] MongoDB 已连接');
      return true;
    } catch (err) {
      console.error('[db] MongoDB 连接失败（接口将返回兜底错误）:', err.message);
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

function getUsers() {
  return db.collection('users');
}

module.exports = { isDbReady, ensureDb, getUsers };
