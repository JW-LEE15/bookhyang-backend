// test/aiLimiters.test.js: AI 사용자별 횟수 제한 설정 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  userKeyGenerator,
  AI_MINUTE_LIMIT_OPTIONS,
  AI_DAY_LIMIT_OPTIONS,
  aiMinuteLimiter,
  aiDayLimiter,
} = require('../middleware/aiLimiters');

test('분당 5회, 하루(24시간) 50회', () => {
  assert.equal(AI_MINUTE_LIMIT_OPTIONS.windowMs, 60 * 1000);
  assert.equal(AI_MINUTE_LIMIT_OPTIONS.limit, 5);
  assert.equal(AI_DAY_LIMIT_OPTIONS.windowMs, 24 * 60 * 60 * 1000);
  assert.equal(AI_DAY_LIMIT_OPTIONS.limit, 50);
});

test('키는 IP가 아니라 로그인한 사용자 id', () => {
  assert.equal(userKeyGenerator({ userId: 'user-1', ip: '203.0.113.7' }), 'user-1');
  assert.notEqual(userKeyGenerator({ userId: 'user-1' }), userKeyGenerator({ userId: 'user-2' }));
});

test('제한 미들웨어는 함수다', () => {
  assert.equal(typeof aiMinuteLimiter, 'function');
  assert.equal(typeof aiDayLimiter, 'function');
});
