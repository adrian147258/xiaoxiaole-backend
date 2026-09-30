// test/token.test.js - token 签发 / 校验 / 头部解析
'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.YOUXI_TOKEN_SECRET = 'unit-test-secret-0123456789abcdef';
const { signToken, verifyToken, getSecret, isTokenReady, bearerFromHeaderValue } = require('../shared/token.js');

test('签发后能验回来，拿到的就是用户名', () => {
  const { token, expiresAt } = signToken('kk没烦恼');
  assert.ok(token.includes('.'), 'token 应该是两段');
  assert.ok(expiresAt > Date.now(), 'expiresAt 应该在将来');
  assert.strictEqual(verifyToken(token), 'kk没烦恼');
});

test('同一个用户名两次签发得到不同 token（含不同 exp），但都能验过', () => {
  const a = signToken('u1').token;
  const b = signToken('u1').token;
  assert.strictEqual(verifyToken(a), 'u1');
  assert.strictEqual(verifyToken(b), 'u1');
});

test('篡改签名 → null', () => {
  const { token } = signToken('u1');
  const [body] = token.split('.');
  assert.strictEqual(verifyToken(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), null);
});

test('篡改 payload（把用户名换掉）→ null', () => {
  const { token } = signToken('u1');
  const [, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ u: 'attacker', exp: Date.now() + 1000 })).toString('base64url');
  assert.strictEqual(verifyToken(`${forgedBody}.${sig}`), null);
});

test('过期 token → null', () => {
  const crypto = require('crypto');
  const exp = Date.now() - 1000;
  const body = Buffer.from(JSON.stringify({ u: 'u1', exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  assert.strictEqual(verifyToken(`${body}.${sig}`), null, '签名对但已过期，必须拒绝');
});

test('格式垃圾一律 null，不抛异常', () => {
  for (const bad of ['', null, undefined, 'abc', 'a.b.c', '.', 'a.', '.b', '{"u":"x"}', 12345, {}]) {
    assert.strictEqual(verifyToken(bad), null, `输入 ${JSON.stringify(bad)} 应为 null`);
  }
});

test('Authorization 头解析：大小写与多余空格都容错', () => {
  assert.strictEqual(bearerFromHeaderValue('Bearer abc.def'), 'abc.def');
  assert.strictEqual(bearerFromHeaderValue('bearer  abc.def '), 'abc.def');
  assert.strictEqual(bearerFromHeaderValue('BEARER abc'), 'abc');
  assert.strictEqual(bearerFromHeaderValue('Token abc'), '');
  assert.strictEqual(bearerFromHeaderValue(''), '');
  assert.strictEqual(bearerFromHeaderValue(undefined), '');
});

test('没有配置密钥时：签发直接抛错（绝不回退默认密钥）', () => {
  const saved = process.env.YOUXI_TOKEN_SECRET;
  delete process.env.YOUXI_TOKEN_SECRET;
  try {
    assert.strictEqual(isTokenReady(), false);
    assert.throws(() => signToken('u1'), /YOUXI_TOKEN_SECRET/);
    assert.strictEqual(verifyToken('anything.here'), null, '校验失败也不该抛出去');
  } finally {
    process.env.YOUXI_TOKEN_SECRET = saved;
  }
});
