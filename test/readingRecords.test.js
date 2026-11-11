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

// ---- 메모 ----
const { getNote, upsertNote, deleteNote } = require('../services/readingRecords');

// 쿼리마다 준비된 { rowCount, rows }를 순서대로 돌려주는 가짜 pool
const scriptedPool = (...results) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return results[calls.length - 1] ?? { rowCount: 0, rows: [] };
    },
  };
};

const NOTE_ROW = { id: '3', user_book_id: 7, content: '메모', created_at: 'c', updated_at: 'u' };

test('메모 조회: 내 도서의 메모를 돌려주고 쿼리에 user_id가 들어간다', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [NOTE_ROW] });
  const out = await getNote(pool, { userId: 'u1', id: 7 });
  assert.deepEqual(out, { result: 'ok', data: NOTE_ROW });
  assert.deepEqual(pool.calls[0].params, [7, 'u1']);
  assert.match(pool.calls[0].sql, /ub\.user_id = \$2/);
});

test('메모 조회: 내 도서인데 메모가 없으면 data가 null', async () => {
  const empty = { id: null, user_book_id: null, content: null, created_at: null, updated_at: null };
  const pool = scriptedPool({ rowCount: 1, rows: [empty] });
  assert.deepEqual(await getNote(pool, { userId: 'u1', id: 7 }), { result: 'ok', data: null });
});

test('메모 조회: 남의 도서와 없는 도서는 똑같이 not_found', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] });
  assert.deepEqual(await getNote(pool, { userId: 'u1', id: 7 }), { result: 'not_found' });
});

test('메모 저장: 소유 확인과 쓰기를 한 쿼리에서 하고 user_id가 파라미터로 들어간다', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [NOTE_ROW] });
  const out = await upsertNote(pool, { userId: 'u1', id: 7, content: '메모' });
  assert.deepEqual(out, { result: 'ok', data: NOTE_ROW });
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [7, 'u1', '메모']);
  assert.match(pool.calls[0].sql, /ub\.user_id = \$2/);
  assert.match(pool.calls[0].sql, /ON CONFLICT \(user_book_id\)/);
});

test('메모 저장: 남의 도서와 없는 도서는 not_found (0행)', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] });
  assert.deepEqual(await upsertNote(pool, { userId: 'u1', id: 7, content: '메모' }), { result: 'not_found' });
});

test('메모 삭제: 삭제되면 ok이고 쿼리에 user_id 조건이 들어간다', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [{ id: '3' }] });
  assert.deepEqual(await deleteNote(pool, { userId: 'u1', id: 7 }), { result: 'ok' });
  assert.deepEqual(pool.calls[0].params, [7, 'u1']);
  assert.match(pool.calls[0].sql, /ub\.user_id = \$2/);
});

test('메모 삭제: 내 도서인데 메모가 없으면 note_not_found', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] }, { rowCount: 1, rows: [{}] });
  assert.deepEqual(await deleteNote(pool, { userId: 'u1', id: 7 }), { result: 'note_not_found' });
  assert.deepEqual(pool.calls[1].params, [7, 'u1']); // 구분 조회에도 user_id가 들어간다
  assert.match(pool.calls[1].sql, /user_id = \$2/);
});

test('메모 삭제: 남의 도서와 없는 도서는 not_found', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] }, { rowCount: 0, rows: [] });
  assert.deepEqual(await deleteNote(pool, { userId: 'u1', id: 7 }), { result: 'not_found' });
});
