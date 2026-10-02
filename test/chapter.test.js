'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProgress, TOTAL_LEVELS } = require('../shared/progress.js');
const { sanitizeRun } = require('../shared/leaderboard.js');

test('远征六关的存档、解锁和排行榜白名单保持一致', () => {
  assert.equal(TOTAL_LEVELS, 24);
  for (let level = 19; level <= 24; level++) {
    const id = `chapter-0${level}`;
    assert.deepEqual(sanitizeProgress({ unlocked: level - 1, stars: { [id]: 3 } }), { unlocked: level - 1, stars: { [id]: 3 } });
    assert.ok(sanitizeRun({ levelId: id, score: 6000, movesUsed: 30, completed: true }));
  }
  assert.equal(sanitizeProgress({ unlocked: 24, stars: {} }), null);
  for (const id of ['chapter-018', 'chapter-025', 'procedural-13', 'level-999']) {
    assert.deepEqual(sanitizeProgress({ unlocked: 23, stars: { [id]: 3 } }).stars, {});
    assert.equal(sanitizeRun({ levelId: id, score: 6000, movesUsed: 30, completed: true }), null);
  }
});
