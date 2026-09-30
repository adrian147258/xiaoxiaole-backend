// cloud-functions/api/login.js - EdgeOne Pages Cloud Functions 独立 Handler
// 职责：POST /api/login，校验用户名 + 密码。标准 Request/Response 写法。
import { handleApiRequest } from '../../shared/router.js';

export default async function onRequest(context) {
  return handleApiRequest(context.request);
}
