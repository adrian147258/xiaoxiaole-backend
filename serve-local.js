// serve-local.js - 本地联调服务器（kk 同款：Node http 把请求包装成标准 Request 调 handleApiRequest）
// 职责：监听 3000 端口，复用与线上完全相同的 shared/router.js 业务，供 npm start / npm run dev 本地调试接口。
const http = require('http');
const { handleApiRequest } = require('./shared/router.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      const request = new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: body.length > 0 ? body.toString('utf8') : undefined,
      });
      const response = await handleApiRequest(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    } catch (err) {
      console.error('[serve-local] 处理异常:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '服务器开小差了，请稍后再试' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`[serve-local] youxi-backend 已启动: http://localhost:${PORT}`);
  console.log('[serve-local] GET  /api/health');
  console.log('[serve-local] POST /api/register');
});
