// scripts/acceptance-progress.cjs - 进度存档接口验收（方案第 10 节）
// 用法：先起后端（带 YOUXI_TOKEN_SECRET），再 `node scripts/acceptance-progress.cjs [BASE]`
// 默认 BASE=http://localhost:3000。脚本自己造测试账号，跑完删干净。
'use strict';

const BASE = process.argv[2] || process.env.BASE || 'http://localhost:3000';
process.env.YOUXI_TOKEN_SECRET = process.env.YOUXI_TOKEN_SECRET || 'local-dev-secret-0123456789abcdef';

const { verifyToken, signToken } = require('../shared/token.js');
const { MongoClient } = require('mongodb');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? '  → ' + detail : ''}`);
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON（比如 EdgeOne 的 HTML 404）保持 null */
  }
  return { status: res.status, data, headers: res.headers };
}

const rnd = () => Math.random().toString(36).slice(2, 8);

(async () => {
  const A = `accA_${rnd()}`;
  const B = `accB_${rnd()}`;
  const PW = 'Abcd1234';
  const created = [A, B];

  console.log(`\n验收 BASE=${BASE}\n测试账号: ${A} / ${B}\n`);

  // ---------- 注册：应返回 token ----------
  const regA = await api('/api/register', { method: 'POST', body: { username: A, password: PW } });
  check('注册成功且返回 token', regA.status === 200 && !!regA.data?.token, `HTTP ${regA.status}`);
  const tokenA = regA.data?.token;
  check('返回的 token 能被 verifyToken 验过', verifyToken(tokenA) === A, String(verifyToken(tokenA)));
  check('expiresAt 是未来的毫秒时间戳', Number(regA.data?.expiresAt) > Date.now());

  const regB = await api('/api/register', { method: 'POST', body: { username: B, password: PW } });
  const tokenB = regB.data?.token;

  // ---------- 场景 9：非法数据 ----------
  console.log('\n[场景 9] 非法数据校验');
  const bad = [
    ['unlocked:-1', { progress: { unlocked: -1, stars: {} } }, 400],
    ['unlocked:999', { progress: { unlocked: 999, stars: {} } }, 400],
    ['progress 不是对象', { progress: 'nope' }, 400],
    ['stars 超 100 个 key', { progress: { unlocked: 1, stars: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`level-${String(i).padStart(3, '0')}`, 1])) } }, 400],
  ];
  for (const [label, body, want] of bad) {
    const r = await api('/api/progress', { method: 'POST', token: tokenA, body });
    check(`拒绝 ${label}`, r.status === want, `HTTP ${r.status}`);
  }
  const dirty = await api('/api/progress', {
    method: 'POST',
    token: tokenA,
    body: { progress: { unlocked: 2, stars: { 'level-001': 9, 'level-002': -3, hacker: 3, 'stars.$gt': 3 } } },
  });
  check('星数被钳到 3', dirty.data?.progress?.stars?.['level-001'] === 3, JSON.stringify(dirty.data?.progress?.stars));
  check('未知关卡 id 被丢弃', !('hacker' in (dirty.data?.progress?.stars || {})), JSON.stringify(dirty.data?.progress?.stars));

  // ---------- 读取 ----------
  console.log('\n[读取存档]');
  const got = await api('/api/progress', { token: tokenA });
  check('GET 返回自己的存档', got.status === 200 && got.data?.progress?.unlocked === 2, JSON.stringify(got.data?.progress));
  check('响应不含 username 字段', !JSON.stringify(got.data || {}).includes(A));

  // ---------- 场景 5：拿 A 的 token 改 B ----------
  console.log('\n[场景 5] 伪造 body.username 不能改别人');
  await api('/api/progress', { method: 'POST', token: tokenB, body: { progress: { unlocked: 1, stars: { 'level-009': 1 } } } });
  const forge = await api('/api/progress', {
    method: 'POST',
    token: tokenA,
    body: { username: B, progress: { unlocked: 17, stars: { 'level-016': 3 } } },
  });
  check('伪造请求本身成功（写的是 A）', forge.status === 200, `HTTP ${forge.status}`);
  const gotB = await api('/api/progress', { token: tokenB });
  check('B 的存档没被动过', gotB.data?.progress?.unlocked === 1 && !gotB.data?.progress?.stars?.['level-016'], JSON.stringify(gotB.data?.progress));
  const gotA = await api('/api/progress', { token: tokenA });
  check('A 收到了这次写入', gotA.data?.progress?.unlocked === 17, JSON.stringify(gotA.data?.progress));

  // ---------- 场景 8：并发并集 ----------
  console.log('\n[场景 8] 并发提交 → 并集（原子 $max）');
  const C = `accC_${rnd()}`;
  created.push(C);
  const regC = await api('/api/register', { method: 'POST', body: { username: C, password: PW } });
  const tokenC = regC.data?.token;
  await Promise.all([
    api('/api/progress', { method: 'POST', token: tokenC, body: { progress: { unlocked: 5, stars: { 'level-001': 3 } } } }),
    api('/api/progress', { method: 'POST', token: tokenC, body: { progress: { unlocked: 7, stars: { 'level-002': 2 } } } }),
    api('/api/progress', { method: 'POST', token: tokenC, body: { progress: { unlocked: 3, stars: { 'level-003': 1 } } } }),
  ]);
  const conc = await api('/api/progress', { token: tokenC });
  const cs = conc.data?.progress?.stars || {};
  check('并发三次提交，星都是并集', cs['level-001'] === 3 && cs['level-002'] === 2 && cs['level-003'] === 1, JSON.stringify(cs));
  check('unlocked 取到最大值 7', conc.data?.progress?.unlocked === 7, String(conc.data?.progress?.unlocked));

  // ---------- 永不回退（$max 的核心性质）----------
  console.log('\n[永不回退] 提交更小的值不能把进度拉回去');
  await api('/api/progress', { method: 'POST', token: tokenC, body: { progress: { unlocked: 1, stars: { 'level-001': 1, 'level-002': 1 } } } });
  const back = await api('/api/progress', { token: tokenC });
  check('unlocked 仍是 7（没被 1 拉回）', back.data?.progress?.unlocked === 7, String(back.data?.progress?.unlocked));
  check('星数仍是 3/2（没被 1 拉回）', back.data?.progress?.stars?.['level-001'] === 3 && back.data?.progress?.stars?.['level-002'] === 2, JSON.stringify(back.data?.progress?.stars));
  // ---------- 首次读取：无存档必须返回 null（前端据此走迁移而不是重置）----------
  const ghostToken = signToken(`ghost_${rnd()}`).token;
  const ghost = await api('/api/progress', { token: ghostToken });
  check('无存档用户 → 200 且 progress:null', ghost.status === 200 && ghost.data?.progress === null, `HTTP ${ghost.status} progress=${JSON.stringify(ghost.data?.progress)}`);

  // ---------- 场景 10：坏 token ----------
  console.log('\n[场景 10] 无效 / 伪造 / 篡改 token → 401');
  const noToken = await api('/api/progress');
  check('无 token → 401 JSON', noToken.status === 401 && noToken.data?.ok === false, `HTTP ${noToken.status}`);
  const garbage = await api('/api/progress', { token: 'not-a-token' });
  check('垃圾 token → 401', garbage.status === 401);
  const forged = await api('/api/progress', { token: signToken(A).token.replace(/.$/, 'X') });
  check('签名被篡改 → 401', forged.status === 401);
  const bodyOnly = signToken(A).token.split('.')[0];
  const noSig = await api('/api/progress', { token: bodyOnly });
  check('只有 payload 没签名 → 401', noSig.status === 401);
  const stillAlive = await api('/api/health');
  check('服务未崩溃（health 仍 200）', stillAlive.status === 200, JSON.stringify(stillAlive.data));

  // ---------- 场景 11：CORS 预检 ----------
  console.log('\n[场景 11] 跨域预检');
  const pre = await api('/api/progress', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const allow = pre.headers.get('access-control-allow-headers') || '';
  check('OPTIONS 预检返回 204', pre.status === 204, `HTTP ${pre.status}`);
  check('Allow-Headers 含 Authorization', /authorization/i.test(allow), allow);
  check('Allow-Origin 已回显', !!pre.headers.get('access-control-allow-origin'), String(pre.headers.get('access-control-allow-origin')));
  const real = await api('/api/progress', { token: tokenA, headers: { Origin: 'https://example.com' } });
  check('真实响应也带 CORS 头', !!real.headers.get('access-control-allow-origin'));

  // ---------- 登录也发 token ----------
  console.log('\n[登录]');
  const lg = await api('/api/login', { method: 'POST', body: { username: A, password: PW } });
  check('登录成功且返回 token', lg.status === 200 && verifyToken(lg.data?.token) === A, `HTTP ${lg.status}`);
  const wrong = await api('/api/login', { method: 'POST', body: { username: A, password: 'WrongPass1' } });
  check('密码错误仍是 401', wrong.status === 401 && !wrong.data?.token, `HTTP ${wrong.status}`);

  // ---------- 清理 ----------
  console.log('\n[清理测试数据]');
  const uri = process.env.MONGODB_URI;
  if (uri) {
    require('dns').setServers(['223.5.5.5', '114.114.114.114']);
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
    try {
      await c.connect();
      const u = await c.db('youxi').collection('users').deleteMany({ username: { $in: created } });
      const p = await c.db('youxi').collection('progress').deleteMany({ username: { $in: created } });
      console.log(`  删除 users ${u.deletedCount} 条 / progress ${p.deletedCount} 条`);
    } catch (e) {
      console.log('  清理失败（不影响功能）: ' + e.message);
    } finally {
      await c.close().catch(() => {});
    }
  } else {
    console.log('  未设置 MONGODB_URI，跳过清理（请手动删除 ' + created.join(', ') + '）');
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n===== 验收结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
