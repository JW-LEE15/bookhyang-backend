// test/aiCache.test.js: TTL 캐시 (순수 함수 테스트, 시계는 주입)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache } = require('../services/ai/cache');

test('TTL 안에서는 값을 돌려주고 지나면 없어진다', () => {
  let time = 1000;
  const cache = createTtlCache({ ttlMs: 20000, now: () => time });
  cache.set('a', { v: 1 });
  assert.deepEqual(cache.get('a'), { v: 1 });
  time += 19999;
  assert.deepEqual(cache.get('a'), { v: 1 });
  time += 1;
  assert.equal(cache.get('a'), undefined);
});

test('다시 set하면 TTL이 처음부터 다시 시작한다', () => {
  let time = 0;
  const cache = createTtlCache({ ttlMs: 100, now: () => time });
  cache.set('a', 1);
  time = 90;
  cache.set('a', 2);
  time = 150;
  assert.equal(cache.get('a'), 2);
  time = 190;
  assert.equal(cache.get('a'), undefined);
});

test('delete는 항목을 지운다', () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  cache.set('a', 1);
  cache.delete('a');
  assert.equal(cache.get('a'), undefined);
});

test('항목 수가 한도를 넘으면 오래된 것부터 지운다', () => {
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size(), 2);
});

test('만료된 항목을 먼저 치우고 나서 한도를 본다', () => {
  let time = 0;
  const cache = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => time });
  cache.set('a', 1);
  time = 50;
  cache.set('b', 2);
  time = 120; // a는 만료, b는 아직 유효
  cache.set('c', 3);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('Promise도 값으로 저장할 수 있다', async () => {
  const cache = createTtlCache({ ttlMs: 1000 });
  const promise = Promise.resolve('결과');
  cache.set('a', promise);
  assert.equal(await cache.get('a'), '결과');
});
