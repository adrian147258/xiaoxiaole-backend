'use strict';

const LEVEL_ID = /^(level-00[1-6]|procedural-([1-9]|1[0-2]))$/;
function sanitizeRun(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.levelId !== 'string' || !LEVEL_ID.test(input.levelId)) return null;
  if (!Number.isSafeInteger(input.score) || input.score < 0 || input.score > 200000000) return null;
  if (!Number.isSafeInteger(input.movesUsed) || input.movesUsed < 0 || input.movesUsed > 100000) return null;
  if (input.completed !== true) return null;
  return { levelId: input.levelId, score: input.score, movesUsed: input.movesUsed };
}

const indexed = new WeakMap();
async function ensureIndexes(col) {
  if (!indexed.has(col)) {
    const job = Promise.all([
      col.createIndex({ levelId: 1, username: 1 }, { unique: true }),
      col.createIndex({ levelId: 1, 'scoreRecord.score': -1, 'scoreRecord.movesUsed': 1, username: 1 }),
      col.createIndex({ levelId: 1, 'movesRecord.movesUsed': 1, 'movesRecord.score': -1, username: 1 }),
    ]).catch(error => { indexed.delete(col); throw error; });
    indexed.set(col, job);
  }
  await indexed.get(col);
}

/** 两个最佳记录以原子更新维护，保留该次实际得分与用步数的对应关系。 */
function updatePipeline(run) {
  const record = { score: run.score, movesUsed: run.movesUsed };
  const best = (field, primary, secondary, direction) => ({ $cond: [
    { $or: [
      { $eq: [{ $type: `$${field}` }, 'missing'] },
      { [direction]: [record[primary], `$${field}.${primary}`] },
      { $and: [
        { $eq: [record[primary], `$${field}.${primary}`] },
        { [direction === '$gt' ? '$lt' : '$gt']: [record[secondary], `$${field}.${secondary}`] },
      ] },
    ] },
    { $literal: record }, `$${field}`,
  ] });
  return [{ $set: {
    scoreRecord: best('scoreRecord', 'score', 'movesUsed', '$gt'),
    movesRecord: best('movesRecord', 'movesUsed', 'score', '$lt'),
    updatedAt: '$$NOW',
  } }];
}

async function saveRun(col, username, run) {
  await ensureIndexes(col);
  const write = () => col.updateOne({ levelId: run.levelId, username }, updatePipeline(run), { upsert: true });
  try { await write(); }
  catch (error) { if (error && error.code === 11000) await write(); else throw error; }
}

async function loadLeaderboard(col, levelId, sort, page) {
  await ensureIndexes(col);
  const field = sort === 'moves' ? 'movesRecord' : 'scoreRecord';
  const order = sort === 'moves'
    ? { [`${field}.movesUsed`]: 1, [`${field}.score`]: -1, username: 1 }
    : { [`${field}.score`]: -1, [`${field}.movesUsed`]: 1, username: 1 };
  const size = 20;
  const documents = await col.find({ levelId }, { projection: { _id: 0, username: 1, [field]: 1 } })
    .sort(order).skip((page - 1) * size).limit(size + 1).toArray();
  return {
    levelId, sort, page, hasNext: documents.length > size,
    entries: documents.slice(0, size).map((doc, index) => ({
      rank: (page - 1) * size + index + 1, username: doc.username,
      score: doc[field].score, movesUsed: doc[field].movesUsed,
    })),
  };
}

module.exports = { LEVEL_ID, sanitizeRun, updatePipeline, saveRun, loadLeaderboard };
