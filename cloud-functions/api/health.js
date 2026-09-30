// cloud-functions/api/health.js - EdgeOne Pages Cloud Functions 独立 Handler
// 职责：GET /api/health，返回 {ok:true}。标准 Request/Response 写法。
import { handleApiRequest } from '../../shared/router.js';

export default async function onRequest(context) {
  return handleApiRequest(context.request);
}
