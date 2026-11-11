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

// ---- 조회 (MY 요약, AI 리포트용) ----
const {
  toCount,
  countByStatus,
  countCompletedInPeriod,
  countNotes,
  listRecentCompleted,
  listCompletedBooks,
  listNotes,
  buildSummary,
  getReadingSummary,
} = require('../services/readingRecords');

// SQL 내용으로 결과를 고르는 가짜 pool (병렬 호출에도 순서에 의존하지 않는다)
const routedPool = (routes) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [pattern, result] of routes) {
        if (pattern.test(sql)) return result;
      }
      return { rowCount: 0, rows: [] };
    },
  };
};

test('toCount: pg의 문자열 COUNT를 숫자로', () => {
  assert.equal(toCount('12'), 12);
  assert.equal(toCount(0), 0);
  assert.equal(toCount(undefined), 0);
  assert.equal(toCount(null), 0);
});

test('countByStatus: 문자열 COUNT를 숫자로 바꾸고 user_id를 넣는다', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [{ total: '9', completed: '4', reading: '3', wish: '1' }] });
  assert.deepEqual(await countByStatus(pool, { userId: 'u1' }), { total: 9, completed: 4, reading: 3, wish: 1 });
  assert.deepEqual(pool.calls[0].params, ['u1']);
  assert.match(pool.calls[0].sql, /WHERE user_id = \$1/);
});

test('countNotes: reading_notes를 user_books와 조인해서 user_id로 제한', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [{ n: '2' }] });
  assert.equal(await countNotes(pool, { userId: 'u1' }), 2);
  assert.deepEqual(pool.calls[0].params, ['u1']);
  assert.match(pool.calls[0].sql, /JOIN user_books ub ON ub\.id = n\.user_book_id/);
  assert.match(pool.calls[0].sql, /ub\.user_id = \$1/);
});

test('listRecentCompleted: 완독일 내림차순, 빈 완독일은 뒤로, 같으면 id 내림차순', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] });
  await listRecentCompleted(pool, { userId: 'u1', limit: 3 });
  assert.deepEqual(pool.calls[0].params, ['u1', 3]);
  assert.match(pool.calls[0].sql, /ORDER BY read_end_date DESC NULLS LAST, id DESC/);
  assert.match(pool.calls[0].sql, /status = 'COMPLETED'/);
});

test('listCompletedBooks: 기간 [from, to), user_id, limit 상한 200', async () => {
  const pool = scriptedPool({ rowCount: 1, rows: [{ id: 1 }] });
  const rows = await listCompletedBooks(pool, { userId: 'u1', from: '2026-11-01', to: '2026-12-01', limit: 9999 });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.deepEqual(pool.calls[0].params, ['u1', '2026-11-01', '2026-12-01', 200]);
  assert.match(pool.calls[0].sql, /read_end_date >= \$2::date AND read_end_date < \$3::date/);
  assert.match(pool.calls[0].sql, /user_id = \$1/);
});

test('listNotes: 한국 날짜 기준 기간 [from, to), user_id, limit 기본 50', async () => {
  const pool = scriptedPool({ rowCount: 0, rows: [] });
  await listNotes(pool, { userId: 'u1', from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(pool.calls[0].params, ['u1', '2026-11-01', '2026-12-01', 50]);
  assert.match(pool.calls[0].sql, /AT TIME ZONE 'Asia\/Seoul'/);
  assert.match(pool.calls[0].sql, /ub\.user_id = \$1/);
});

test('기간 함수: 잘못된 기간은 DB를 부르기 전에 예외 (메시지에 입력값이 없다)', async () => {
  const pool = scriptedPool();
  for (const fn of [listCompletedBooks, listNotes, countCompletedInPeriod]) {
    await assert.rejects(() => fn(pool, { userId: 'u1', from: '2026-12-01', to: '2026-11-01' }), /기간 인자/);
    await assert.rejects(
      () => fn(pool, { userId: 'u1', from: 'secret-x', to: '2026-11-01' }),
      (error) => !error.message.includes('secret-x')
    );
  }
  assert.equal(pool.calls.length, 0);
});

test('buildSummary: 응답 모양으로 조립', () => {
  const recent = [{ id: 5, book_id: 1, title: 't', author: 'a', isbn: 'i', cover_image: 'c', read_end_date: '2026-11-10' }];
  assert.deepEqual(
    buildSummary({
      month: '2026-11',
      counts: { total: 9, completed: 4, reading: 3, wish: 1 },
      completedThisMonth: 2,
      notes: 6,
      recentCompleted: recent,
    }),
    {
      month: '2026-11',
      counts: { total: 9, completed: 4, reading: 3, wish: 1, completed_this_month: 2, notes: 6 },
      recent_completed: recent,
    }
  );
});

test('getReadingSummary: 한국 시간 이번 달로 조회하고 모든 쿼리에 user_id가 들어간다', async () => {
  const pool = routedPool([
    [/COUNT\(\*\) AS total/, { rowCount: 1, rows: [{ total: '9', completed: '4', reading: '3', wish: '1' }] }],
    [/read_end_date >= \$2::date/, { rowCount: 1, rows: [{ n: '2' }] }],
    [/FROM reading_notes/, { rowCount: 1, rows: [{ n: '6' }] }],
    [/NULLS LAST/, { rowCount: 1, rows: [{ id: 5, read_end_date: '2026-11-10' }] }],
  ]);
  // 한국 시간 2026-12-01 00:30 (UTC로는 11월 30일) -> 이번 달은 12월
  const data = await getReadingSummary(pool, { userId: 'u1', now: new Date('2026-11-30T15:30:00Z'), recent: 3 });
  assert.deepEqual(data, {
    month: '2026-12',
    counts: { total: 9, completed: 4, reading: 3, wish: 1, completed_this_month: 2, notes: 6 },
    recent_completed: [{ id: 5, read_end_date: '2026-11-10' }],
  });
  assert.equal(pool.calls.length, 4);
  for (const call of pool.calls) assert.equal(call.params[0], 'u1');
  const monthCall = pool.calls.find((call) => /read_end_date >= \$2::date/.test(call.sql));
  assert.deepEqual(monthCall.params, ['u1', '2026-12-01', '2027-01-01']);
  const recentCall = pool.calls.find((call) => /NULLS LAST/.test(call.sql));
  assert.deepEqual(recentCall.params, ['u1', 3]);
});
