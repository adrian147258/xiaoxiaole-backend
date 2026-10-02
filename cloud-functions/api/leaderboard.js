import { handleApiRequest } from '../../shared/router.js';

export default async function onRequest(context) {
  return handleApiRequest(context.request);
}
