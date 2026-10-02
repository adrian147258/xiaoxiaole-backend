'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.YOUXI_TOKEN_SECRET = 'local-leaderboard-unit-test-secret';
let writes = [];
const col = {
  createIndex: async () => {},
  updateOne: async (filter, pipeline) => { writes.push({ filter, pipeline }); },
  find: () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, async toArray() { return []; } }),
};
for (const [path, exports] of [
  ['../shared/db.js', { isDbReady: () => true, ensureDb: async () => true, getLeaderboard: () => col }],
  ['../shared/auth.js', { register: async () => ({ ok: false }), login: async () => ({ ok: false }) }],
]) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const { signToken } = require('../shared/token.js');
const { handleApiRequest } = require('../shared/router.js');
const request = (method, path, body, token) => new Request('https://example.test' + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('未认证写入拒绝；GET允许读取，OPTIONS保留跨域兼容', async () => {
  assert.equal((await handleApiRequest(request('POST', '/api/leaderboard', { completed: true }))).status, 401);
  const response = await handleApiRequest(request('GET', '/api/leaderboard?levelId=level-001&sort=score'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, []);
  const preflight = await handleApiRequest(request('OPTIONS', '/api/leaderboard'));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('身份仅来自签名token，忽略请求伪造username', async () => {
  writes = [];
  const token = signToken('真实玩家').token;
  const response = await handleApiRequest(request('POST', '/api/leaderboard', { levelId: 'level-001', score: 1000, movesUsed: 9, completed: true, username: '伪造玩家' }, token));
  assert.equal(response.status, 200);
  assert.deepEqual(writes[0].filter, { username: '真实玩家', levelId: 'level-001' });
});

test('非法关卡、分页、排序、未通关及超大请求体不写入', async () => {
  for (const query of ['levelId=level-999', 'levelId=level-001&sort=evil', 'levelId=level-001&page=-1', 'levelId=level-001&page=1.5']) {
    assert.equal((await handleApiRequest(request('GET', '/api/leaderboard?' + query))).status, 400);
  }
  const token = signToken('真实玩家').token;
  const body = { levelId: 'level-001', score: 1000, movesUsed: 1, completed: false };
  assert.equal((await handleApiRequest(request('POST', '/api/leaderboard', body, token))).status, 400);
  assert.equal((await handleApiRequest(request('POST', '/api/leaderboard', { ...body, padding: 'x'.repeat(11000) }, token))).status, 400);
});

test('旧健康接口与未知路由保持行为', async () => {
  const response = await handleApiRequest(request('GET', '/api/health'));
  assert.deepEqual(await response.json(), { ok: true, tokenReady: true });
  assert.equal((await handleApiRequest(request('GET', '/api/not-found'))).status, 404);
});
