// test/usageGuard.test.js: 서버 전체 하루 호출 제한 (순수 함수 테스트, 시계는 주입)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUOTA_TIME_ZONE,
  getQuotaDayKey,
  parseDailyLimit,
  computeThreshold,
  createUsageGuard,
} = require('../services/ai/usageGuard');

test('하루의 기준 시간대는 America/Los_Angeles', () => {
  assert.equal(QUOTA_TIME_ZONE, 'America/Los_Angeles');
});

test('AI_DAILY_LIMIT 해석: 양의 정수만, 아니면 기본 500', () => {
  assert.equal(parseDailyLimit('100'), 100);
  assert.equal(parseDailyLimit(' 20 '), 20);
  for (const bad of [undefined, '', '0', '-5', '1.5', 'abc', '1e3']) {
    assert.equal(parseDailyLimit(bad), 500, `입력: ${bad}`);
  }
});

test('임계값은 한도의 90%를 내린 값', () => {
  assert.equal(computeThreshold(500), 450);
  assert.equal(computeThreshold(3), 2);
  assert.equal(computeThreshold(10), 9);
  assert.equal(computeThreshold(1), 0);
});

test('하루 키는 태평양시 기준이다 (겨울: UTC-8)', () => {
  assert.equal(getQuotaDayKey(new Date('2026-11-11T07:59:00Z')), '2026-11-10');
  assert.equal(getQuotaDayKey(new Date('2026-11-11T08:01:00Z')), '2026-11-11');
});

test('예약은 임계값까지만 되고 그다음은 거절한다', () => {
  const guard = createUsageGuard({ dailyLimit: 10, now: () => new Date('2026-11-11T12:00:00Z') });
  assert.equal(guard.threshold, 9);
  for (let i = 0; i < 9; i += 1) assert.equal(guard.reserve(), true, `${i + 1}번째`);
  assert.equal(guard.isExhausted(), true);
  assert.equal(guard.reserve(), false);
  assert.equal(guard.getCount(), 9);
});

test('날짜가 바뀌면 카운터가 0으로 돌아간다', () => {
  let current = new Date('2026-11-11T07:00:00Z'); // 태평양시 11월 10일
  const guard = createUsageGuard({ dailyLimit: 3, now: () => current }); // 임계값 2
  assert.equal(guard.reserve(), true);
  assert.equal(guard.reserve(), true);
  assert.equal(guard.reserve(), false);

  current = new Date('2026-11-11T09:00:00Z'); // 태평양시 11월 11일
  assert.equal(guard.isExhausted(), false);
  assert.equal(guard.reserve(), true);
  assert.equal(guard.getCount(), 1);
});

test('한도가 1이면 임계값이 0이라 모두 거절한다', () => {
  const guard = createUsageGuard({ dailyLimit: 1, now: () => new Date('2026-11-11T12:00:00Z') });
  assert.equal(guard.isExhausted(), true);
  assert.equal(guard.reserve(), false);
});
