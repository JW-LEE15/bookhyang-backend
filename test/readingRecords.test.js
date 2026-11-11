// test/readingRecords.test.js: 완독일 수정 서비스 (가짜 pool, DB 접속 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateReadEndDate } = require('../services/readingRecords');

// 호출 기록을 남기고 준비된 결과를 순서대로 돌려주는 가짜 pool
const fakePool = (...rowCounts) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const rowCount = rowCounts[calls.length - 1] ?? 0;
      return {
        rowCount,
        rows: rowCount > 0 ? [{ id: params[1], status: 'COMPLETED', read_end_date: params[0] }] : [],
      };
    },
  };
};

test('완독 도서: 수정되고 쿼리에 user_id와 완독 조건이 들어간다', async () => {
  const pool = fakePool(1);
  const out = await updateReadEndDate(pool, { userId: 'u1', id: 7, readEndDate: '2026-11-01' });
  assert.equal(out.result, 'ok');
  assert.deepEqual(out.data, { id: 7, status: 'COMPLETED', read_end_date: '2026-11-01' });
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, ['2026-11-01', 7, 'u1']);
  assert.match(pool.calls[0].sql, /user_id = \$3/);
  assert.match(pool.calls[0].sql, /status = 'COMPLETED'/);
});

test('내 도서인데 완독이 아니면 not_completed', async () => {
  const pool = fakePool(0, 1);
  const out = await updateReadEndDate(pool, { userId: 'u1', id: 7, readEndDate: '2026-11-01' });
  assert.deepEqual(out, { result: 'not_completed' });
  assert.deepEqual(pool.calls[1].params, [7, 'u1']); // 구분 조회에도 user_id가 들어간다
  assert.match(pool.calls[1].sql, /user_id = \$2/);
});

test('남의 도서와 없는 도서는 똑같이 not_found', async () => {
  const pool = fakePool(0, 0);
  const out = await updateReadEndDate(pool, { userId: 'u1', id: 7, readEndDate: '2026-11-01' });
  assert.deepEqual(out, { result: 'not_found' });
});
