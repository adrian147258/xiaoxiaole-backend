// cloud-functions/api/progress.js - EdgeOne Pages Cloud Functions 独立 Handler
// 职责：GET /api/progress（读存档）、POST /api/progress（写存档）。
// 标准 Request/Response 写法，导出默认函数由平台按文件路由调用。
// 与 register.js 保持一致：实际路由分发仍在 shared/router.js 里按 pathname 完成。
import { handleApiRequest } from '../../shared/router.js';

export default async function onRequest(context) {
  return handleApiRequest(context.request);
}
