'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeRun, updatePipeline, saveRun, loadLeaderboard } = require('../shared/leaderboard.js');

const run = (score, movesUsed) => ({ levelId: 'level-001', score, movesUsed, completed: true });

test('关卡白名单、完整通关、整数分数与实际用步校验', () => {
  assert.deepEqual(sanitizeRun(run(100, 0)), { levelId: 'level-001', score: 100, movesUsed: 0 });
  for (const bad of [null, [], { ...run(1, 1), levelId: 'level-999' }, run(-1, 1), run(1, -1), run(1.2, 2), run(1, Infinity), { ...run(1, 1), completed: false }, { ...run(1, 1), score: '100' }]) assert.equal(sanitizeRun(bad), null);
  assert.ok(sanitizeRun({ ...run(1, 1), levelId: 'procedural-12' }));
});

// 用受限表达式解释器验证真实更新管道的行为，无需连接数据库。
function evaluate(value, doc) {
  if (typeof value === 'string' && value.startsWith('$')) return value.slice(1).split('.').reduce((o, k) => o && o[k], doc);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => evaluate(v, doc));
  if ('$literal' in value) return value.$literal;
  if ('$type' in value) return evaluate(value.$type, doc) === undefined ? 'missing' : 'object';
  if ('$cond' in value) return evaluate(value.$cond[evaluate(value.$cond[0], doc) ? 1 : 2], doc);
  if ('$or' in value) return value.$or.some(v => evaluate(v, doc));
  if ('$and' in value) return value.$and.every(v => evaluate(v, doc));
  for (const op of ['$eq', '$gt', '$lt']) if (op in value) {
    const [a, b] = evaluate(value[op], doc);
    return op === '$eq' ? a === b : op === '$gt' ? a > b : a < b;
  }
  throw new Error('unsupported expression');
}

test('两个榜单保留各自最佳实战纪录，差成绩和重复提交不会覆盖', () => {
  let doc = {};
  const apply = record => {
    const set = updatePipeline(record)[0].$set;
    doc = { scoreRecord: evaluate(set.scoreRecord, doc), movesRecord: evaluate(set.movesRecord, doc) };
  };
  apply(run(2000, 12)); apply(run(1000, 8)); apply(run(1800, 15)); apply(run(1000, 8));
  assert.deepEqual(doc, { scoreRecord: { score: 2000, movesUsed: 12 }, movesRecord: { score: 1000, movesUsed: 8 } });
  apply(run(2000, 10)); apply(run(1200, 8));
  assert.deepEqual(doc, { scoreRecord: { score: 2000, movesUsed: 10 }, movesRecord: { score: 1200, movesUsed: 8 } });
});

test('写入仅用调用方认证身份，唯一键冲突重试，索引失败可重试', async () => {
  let writes = 0, indexes = 0;
  const col = { createIndex: async () => { indexes++; }, updateOne: async (filter, pipeline, options) => {
    assert.deepEqual(filter, { levelId: 'level-001', username: '认证用户' });
    assert.equal(options.upsert, true);
    assert.ok(pipeline[0].$set.scoreRecord);
    if (++writes === 1) throw Object.assign(new Error('duplicate'), { code: 11000 });
  } };
  await saveRun(col, '认证用户', run(1000, 4));
  await saveRun(col, '认证用户', run(2000, 8));
  assert.equal(writes, 3); assert.equal(indexes, 3);
});

test('按关卡分页且两种排序方向正确，不返回认证字段', async () => {
  const orders = [];
  const col = { createIndex: async () => {}, find: (filter, options) => {
    assert.deepEqual(filter, { levelId: 'level-001' });
    assert.equal(options.projection._id, 0);
    return { sort(order) { orders.push(order); return this; }, skip(n) { assert.equal(n, 20); return this; }, limit(n) { assert.equal(n, 21); return this; }, async toArray() {
      return Array.from({ length: 21 }, (_, i) => ({ username: '玩家' + i, scoreRecord: { score: 2000, movesUsed: 12 }, movesRecord: { score: 1000, movesUsed: 8 }, password: '不得返回' }));
    } };
  } };
  const score = await loadLeaderboard(col, 'level-001', 'score', 2);
  const moves = await loadLeaderboard(col, 'level-001', 'moves', 2);
  assert.deepEqual(orders[0], { 'scoreRecord.score': -1, 'scoreRecord.movesUsed': 1, username: 1 });
  assert.deepEqual(orders[1], { 'movesRecord.movesUsed': 1, 'movesRecord.score': -1, username: 1 });
  assert.equal(score.hasNext, true); assert.equal(score.entries.length, 20); assert.equal(score.entries[0].rank, 21);
  assert.equal(score.entries[0].score, 2000); assert.equal(moves.entries[0].movesUsed, 8);
  assert.equal('password' in score.entries[0], false);
});
