// test/progress.test.js - 存档校验与合并
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeProgress,
  mergeProgress,
  publicProgress,
  MAX_UNLOCKED,
  TOTAL_LEVELS,
} = require('../shared/progress.js');

// ---------- sanitizeProgress ----------

test('合法输入原样通过，0 星不入库', () => {
  const r = sanitizeProgress({ unlocked: 7, stars: { 'level-001': 3, 'level-002': 0, 'procedural-1': 2 } });
  assert.deepStrictEqual(r, { unlocked: 7, stars: { 'level-001': 3, 'procedural-1': 2 } });
});

test('unlocked 越界或非整数 → null（应回 400）', () => {
  for (const v of [-1, 999, 1.5, null, NaN, Infinity, undefined, true, {}, []]) {
    assert.strictEqual(sanitizeProgress({ unlocked: v, stars: {} }), null, `unlocked=${JSON.stringify(v)} 应为 null`);
  }
});

test('数字字符串按数字处理（"3" 等价 3），但越界的字符串仍然非法', () => {
  assert.deepStrictEqual(sanitizeProgress({ unlocked: '3', stars: {} }), { unlocked: 3, stars: {} });
  assert.strictEqual(sanitizeProgress({ unlocked: '999', stars: {} }), null);
  assert.strictEqual(sanitizeProgress({ unlocked: 'abc', stars: {} }), null);
});

test('unlocked 边界值 0 与 MAX_UNLOCKED 通过', () => {
  assert.strictEqual(sanitizeProgress({ unlocked: 0, stars: {} }).unlocked, 0);
  assert.strictEqual(sanitizeProgress({ unlocked: MAX_UNLOCKED, stars: {} }).unlocked, MAX_UNLOCKED);
  assert.strictEqual(TOTAL_LEVELS, 24);
});

test('未知关卡 id 静默丢弃，不算非法', () => {
  const r = sanitizeProgress({ unlocked: 1, stars: { 'level-001': 2, hacker: 3, 'stars.$gt': 3, 'a.b': 3 } });
  assert.deepStrictEqual(r.stars, { 'level-001': 2 });
});

test('星数被钳到 0..3', () => {
  const r = sanitizeProgress({ unlocked: 1, stars: { 'level-001': 9, 'level-002': -5, 'level-003': 2.7, 'level-004': 'x' } });
  assert.deepStrictEqual(r.stars, { 'level-001': 3, 'level-003': 2 });
});

test('stars key 超过 100 个 → null', () => {
  const stars = {};
  for (let i = 0; i < 101; i++) stars[`level-${String(i).padStart(3, '0')}`] = 1;
  assert.strictEqual(sanitizeProgress({ unlocked: 1, stars }), null);
});

test('非对象入参 → null', () => {
  for (const bad of [null, undefined, 42, 'str', true, []]) {
    assert.strictEqual(sanitizeProgress(bad), null);
  }
});

test('stars 不是对象时当空处理，不报错', () => {
  assert.deepStrictEqual(sanitizeProgress({ unlocked: 3, stars: 'oops' }), { unlocked: 3, stars: {} });
  assert.deepStrictEqual(sanitizeProgress({ unlocked: 3 }), { unlocked: 3, stars: {} });
});

// ---------- mergeProgress ----------

test('合并取最大值：不回退', () => {
  const a = { unlocked: 8, stars: { 'level-001': 3, 'level-002': 1 } };
  const b = { unlocked: 3, stars: { 'level-001': 2, 'level-003': 3 } };
  assert.deepStrictEqual(mergeProgress(a, b), {
    unlocked: 8,
    stars: { 'level-001': 3, 'level-002': 1, 'level-003': 3 },
  });
});

test('幂等 merge(x,x) === x', () => {
  const x = { unlocked: 5, stars: { 'level-001': 3 } };
  assert.deepStrictEqual(mergeProgress(x, x), x);
});

test('交换律 merge(a,b) === merge(b,a)', () => {
  const a = { unlocked: 8, stars: { 'level-001': 3, 'level-002': 1 } };
  const b = { unlocked: 3, stars: { 'level-001': 2, 'level-003': 3 } };
  assert.deepStrictEqual(mergeProgress(a, b), mergeProgress(b, a));
});

test('结合律 merge(merge(a,b),c) === merge(a,merge(b,c))', () => {
  const a = { unlocked: 2, stars: { 'level-001': 1 } };
  const b = { unlocked: 5, stars: { 'level-002': 3 } };
  const c = { unlocked: 1, stars: { 'level-001': 3, 'level-003': 2 } };
  assert.deepStrictEqual(
    mergeProgress(mergeProgress(a, b), c),
    mergeProgress(a, mergeProgress(b, c)),
  );
});

test('单调不减：合并结果每一维都 >= 任一输入', () => {
  const a = { unlocked: 6, stars: { 'level-001': 1 } };
  const b = { unlocked: 4, stars: { 'level-002': 2 } };
  const m = mergeProgress(a, b);
  assert.ok(m.unlocked >= a.unlocked && m.unlocked >= b.unlocked);
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src.stars)) assert.ok(m.stars[k] >= v);
  }
});

test('null / undefined 入参不报错', () => {
  assert.deepStrictEqual(mergeProgress(null, null), { unlocked: 0, stars: {} });
  assert.deepStrictEqual(mergeProgress(undefined, { unlocked: 2, stars: { 'level-001': 1 } }), {
    unlocked: 2,
    stars: { 'level-001': 1 },
  });
  assert.deepStrictEqual(mergeProgress({ unlocked: 2, stars: {} }, null), { unlocked: 2, stars: {} });
});

// ---------- publicProgress ----------

test('publicProgress 只暴露 unlocked + stars，不外泄 username / revision', () => {
  const doc = { username: 'kk', unlocked: 4, stars: { 'level-001': 2 }, revision: 9, updatedAt: new Date() };
  const pub = publicProgress(doc);
  assert.deepStrictEqual(Object.keys(pub).sort(), ['stars', 'unlocked']);
  assert.strictEqual(JSON.stringify(pub).includes('kk'), false);
});

test('publicProgress(null) → null（前端据此走老账号迁移）', () => {
  assert.strictEqual(publicProgress(null), null);
});
