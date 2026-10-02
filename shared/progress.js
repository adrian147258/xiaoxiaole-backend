// shared/progress.js - 游戏进度存档（读写 + 校验 + 合并）
// 职责：把前端传来的进度校验成干净结构；按「取最大值」规则与库里的存档合并后原子写入。
// 关键约束：
//   1. 前端数据一律不可信 —— 所有写入先过 sanitizeProgress（白名单 id + 钳制 + 体积限制）
//   2. 合并只增不减 —— 用 MongoDB 原子 $max，避免「读→改→写」竞态丢更新
//   3. 身份由 token 决定，本模块只接受调用方传入的 username，不读 body 里的任何 username
'use strict';

/**
 * 关卡总数必须与前端 src/game/levels/index.ts 的 TOTAL_LEVELS 保持一致。
 * 当前 = 6 个启程关 + 12 个秘境关 + 6 个远征关 = 24。
 */
const TOTAL_LEVELS = 24;

/** 解锁上限：0 基下标 */
const MAX_UNLOCKED = TOTAL_LEVELS - 1;

/** 合法关卡 id：level-001..level-006 / procedural-1..procedural-12（已核实真实格式） */
const LEVEL_ID = /^(level-00[1-6]|procedural-([1-9]|1[0-2])|chapter-0(19|2[0-4]))$/;

/** 星数 map 的 key 上限，防超大 payload */
const MAX_STARS_KEYS = 100;

/** 请求体大小上限 10 KB */
const MAX_BODY_BYTES = 10 * 1024;

/**
 * 把任意外部输入校验成 { unlocked, stars }。
 * 返回 null 表示「结构非法」，调用方应回 400；未知关卡 id 静默丢弃（不算非法）。
 */
function sanitizeProgress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  // 只接受数字或数字字符串。不直接 Number(x) 是因为 Number(null) === 0、Number(true) === 1，
  // 会让 null / true 这类垃圾值「意外合法」地写进库。
  const raw = input.unlocked;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const unlocked = Number(raw);
  if (!Number.isInteger(unlocked) || unlocked < 0 || unlocked > MAX_UNLOCKED) return null;

  const rawStars =
    input.stars && typeof input.stars === 'object' && !Array.isArray(input.stars)
      ? input.stars
      : {};
  const keys = Object.keys(rawStars);
  if (keys.length > MAX_STARS_KEYS) return null;

  const stars = {};
  for (const k of keys) {
    if (!LEVEL_ID.test(k)) continue; // 白名单：未知 id 直接丢
    const v = Math.max(0, Math.min(3, Math.floor(Number(rawStars[k]) || 0)));
    if (v > 0) stars[k] = v; // 0 星不入库，保持稀疏
  }
  return { unlocked, stars };
}

/**
 * 取最大值合并（前后端各一份，行为必须一致）。
 * 满足幂等 / 交换律 / 结合律 / 单调不减，null 入参安全。
 */
function mergeProgress(a, b) {
  const stars = { ...(b && b.stars ? b.stars : {}) };
  const src = a && a.stars ? a.stars : {};
  for (const [k, v] of Object.entries(src)) {
    stars[k] = Math.max(stars[k] || 0, v);
  }
  return {
    unlocked: Math.max((a && a.unlocked) || 0, (b && b.unlocked) || 0),
    stars,
  };
}

/** 数据库文档 / 返回值 → 只含 unlocked + stars 的公开结构（绝不外泄 username 等字段） */
function publicProgress(doc) {
  if (!doc) return null;
  return {
    unlocked: Number(doc.unlocked) || 0,
    stars: doc.stars && typeof doc.stars === 'object' ? { ...doc.stars } : {},
  };
}

/** 读取存档；没有文档返回 null（前端据此走「老账号迁移」而不是「重置」） */
async function loadProgress(col, username) {
  const doc = await col.findOne({ username }, { projection: { unlocked: 1, stars: 1 } });
  return publicProgress(doc);
}

/**
 * 原子写入：$max 一次完成「只增不减」的合并。
 * v1 的「先读再写」在两台设备同时提交时会丢更新，所以这里用 $max + upsert。
 * 返回合并后的最终值（前端以它为准，于是客户端永远收敛到服务端状态）。
 */
async function saveProgress(col, username, clean) {
  const $max = { unlocked: clean.unlocked };
  // 这里的 id 已被 LEVEL_ID 白名单约束为不含 '.' 和 '$'，拼进 stars.<id> 是安全的
  for (const [id, v] of Object.entries(clean.stars)) $max[`stars.${id}`] = v;

  const run = () =>
    col.findOneAndUpdate(
      { username },
      { $max, $inc: { revision: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );

  let res;
  try {
    res = await run();
  } catch (err) {
    // 并发 upsert 撞唯一索引：重试一次即可落到更新分支
    if (err && err.code === 11000) res = await run();
    else throw err;
  }

  // 驱动版本差异：v6+ 直接返回文档；v5 返回 { value: 文档 }（本仓库实测 6.21.0）
  const doc = res && Object.prototype.hasOwnProperty.call(res, 'value') ? res.value : res;
  return publicProgress(doc) || { unlocked: clean.unlocked, stars: clean.stars };
}

module.exports = {
  TOTAL_LEVELS,
  MAX_UNLOCKED,
  LEVEL_ID,
  MAX_STARS_KEYS,
  MAX_BODY_BYTES,
  sanitizeProgress,
  mergeProgress,
  publicProgress,
  loadProgress,
  saveProgress,
};
