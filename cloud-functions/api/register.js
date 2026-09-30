// cloud-functions/api/register.js - EdgeOne Pages Cloud Functions 独立 Handler
// 职责：POST /api/register。标准 Request/Response 写法，导出默认函数由平台按文件路由调用。
import { handleApiRequest } from '../../shared/router.js';

export default async function onRequest(context) {
  return handleApiRequest(context.request);
}
