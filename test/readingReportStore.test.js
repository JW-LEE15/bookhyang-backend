// test/readingReportStore.test.js: 독서 리포트 DB 로직 (가짜 pool, DB 접속 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIST_LIMIT,
  parseReportId,
  getCompletedStats,
  countNotesInPeriod,
  insertReport,
  listReports,
  deleteReport,
  buildReportResponse,
} = require('../services/readingReportStore');

const USER = '00000000-0000-4000-8000-000000000001';

// 호출 기록을 남기고 준비된 결과를 돌려주는 가짜 pool
const fakePool = (result = { rows: [], rowCount: 0 }) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return result;
    },
  };
};

// ---- parseReportId ----

test('parseReportId: 양의 정수 문자열만 통과한다', () => {
  assert.equal(parseReportId('1'), '1');
  assert.equal(parseReportId('123456789012345'), '123456789012345'); // 15자리
  for (const bad of ['0', '01', '-1', '1.5', '1e3', ' 1', '1 ', 'abc', '', '1234567890123456', '99999999999999999999', 5, null, undefined, ['1']]) {
    assert.equal(parseReportId(bad), null, String(bad));
  }
});

// ---- getCompletedStats ----

test('getCompletedStats: 분야별 수를 고정 순서(소설, 시, 에세이, 미분류)로 돌려주고 합계를 낸다', async () => {
  const pool = fakePool({
    rows: [
      { category: null, n: '4' }, // pg는 COUNT를 문자열로 준다
      { category: '에세이', n: '1' },
      { category: '소설', n: '2' },
    ],
  });
  const stats = await getCompletedStats(pool, { userId: USER, from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(stats.byCategory, [
    { category: '소설', count: 2 },
    { category: '에세이', count: 1 },
    { category: null, count: 4 },
  ]);
  assert.equal(stats.completedCount, 7);
});

test('getCompletedStats: 기록이 없으면 0과 빈 배열', async () => {
  const stats = await getCompletedStats(fakePool(), { userId: USER, from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(stats, { completedCount: 0, byCategory: [] });
});

test('getCompletedStats: user_id로 제한하고 완독일 기간으로 거르며 books는 LEFT JOIN이다', async () => {
  const pool = fakePool();
  await getCompletedStats(pool, { userId: USER, from: '2026-10-01', to: '2026-11-01' });
  const { sql, params } = pool.calls[0];
  assert.deepEqual(params, [USER, '2026-10-01', '2026-11-01']);
  assert.match(sql, /LEFT JOIN books b ON b\.id = ub\.book_id/);
  assert.match(sql, /ub\.user_id = \$1/);
  assert.match(sql, /ub\.status = 'COMPLETED'/);
  assert.match(sql, /ub\.read_end_date >= \$2::date AND ub\.read_end_date < \$3::date/);
  assert.match(sql, /GROUP BY b\.category/);
});

test('getCompletedStats: 잘못된 기간은 쿼리 전에 예외 (입력값은 메시지에 없다)', async () => {
  const pool = fakePool();
  await assert.rejects(
    () => getCompletedStats(pool, { userId: USER, from: '2026-13-01', to: '2026-11-01' }),
    (error) => !error.message.includes('2026-13-01')
  );
  assert.equal(pool.calls.length, 0);
});

// ---- countNotesInPeriod ----

test('countNotesInPeriod: user_books를 조인해 user_id로 제한하고 한국 날짜 기간으로 센다', async () => {
  const pool = fakePool({ rows: [{ n: '3' }] });
  const count = await countNotesInPeriod(pool, { userId: USER, from: '2026-10-01', to: '2026-11-01' });
  assert.equal(count, 3);
  const { sql, params } = pool.calls[0];
  assert.deepEqual(params, [USER, '2026-10-01', '2026-11-01']);
  assert.match(sql, /JOIN user_books ub ON ub\.id = n\.user_book_id/);
  assert.match(sql, /ub\.user_id = \$1/);
  assert.match(sql, /AT TIME ZONE 'Asia\/Seoul'/);
});

// ---- insertReport ----

test('insertReport: 값은 파라미터로 넘기고 stats와 report는 JSON 문자열로 보낸다', async () => {
  const saved = { id: '5', period_type: 'last_month' };
  const pool = fakePool({ rows: [saved], rowCount: 1 });
  const stats = { completed_count: 2 };
  const report = { interest_topics: [{ text: '글', evidence: { book_ids: ['1'], note_ids: [] } }] };
  const row = await insertReport(pool, {
    userId: USER, periodType: 'last_month', from: '2026-10-01', to: '2026-11-01',
    includeNotes: true, stats, report, promptVersion: 1,
  });
  assert.equal(row, saved);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO reading_reports/);
  assert.match(sql, /\$6::jsonb, \$7::jsonb/);
  assert.deepEqual(params, [USER, 'last_month', '2026-10-01', '2026-11-01', true, JSON.stringify(stats), JSON.stringify(report), 1]);
  assert.ok(!sql.includes(USER)); // 값이 SQL 문자열에 섞이지 않는다
});

test('insertReport: includeNotes는 true일 때만 true로 저장한다', async () => {
  const pool = fakePool({ rows: [{}], rowCount: 1 });
  await insertReport(pool, { userId: USER, periodType: 'this_month', from: 'a', to: 'b', includeNotes: 'true', stats: {}, report: {}, promptVersion: 1 });
  assert.equal(pool.calls[0].params[4], false);
});

// ---- listReports / deleteReport ----

test('listReports: user_id로 제한하고 최신순 20개', async () => {
  const pool = fakePool();
  await listReports(pool, { userId: USER });
  const { sql, params } = pool.calls[0];
  assert.equal(LIST_LIMIT, 20);
  assert.deepEqual(params, [USER, 20]);
  assert.match(sql, /WHERE user_id = \$1/);
  assert.match(sql, /ORDER BY id DESC/);
  const selectedColumns = sql.split('FROM')[0];
  assert.ok(!selectedColumns.includes('user_id') && !selectedColumns.includes('prompt_version'), 'user_id와 prompt_version은 조회 컬럼에 없다');
});

test('deleteReport: id와 user_id를 모두 조건으로 걸고 지워졌는지 돌려준다', async () => {
  const hit = fakePool({ rows: [{ id: '5' }], rowCount: 1 });
  assert.equal(await deleteReport(hit, { userId: USER, id: '5' }), true);
  assert.deepEqual(hit.calls[0].params, ['5', USER]);
  assert.match(hit.calls[0].sql, /WHERE id = \$1::bigint AND user_id = \$2/);

  const miss = fakePool({ rows: [], rowCount: 0 });
  assert.equal(await deleteReport(miss, { userId: USER, id: '5' }), false);
});

// ---- buildReportResponse ----

test('buildReportResponse: id는 문자열, 날짜는 YYYY-MM-DD, 시각은 ISO, 내부 컬럼은 노출하지 않는다', () => {
  const row = {
    id: 12, // bigint가 숫자로 와도 문자열로
    user_id: USER,
    prompt_version: 1,
    period_type: 'last_month',
    period_from: '2026-10-01',
    period_to: '2026-11-01',
    include_notes: true,
    stats: { completed_count: 2 },
    report: { interest_topics: [] },
    created_at: new Date('2026-11-14T01:02:03.000Z'),
  };
  assert.deepEqual(buildReportResponse(row), {
    id: '12',
    generated_at: '2026-11-14T01:02:03.000Z',
    period: { type: 'last_month', label: '2026-10', from: '2026-10-01', to: '2026-11-01' },
    include_notes: true,
    stats: { completed_count: 2 },
    report: { interest_topics: [] },
  });
});

test('buildReportResponse: Date로 온 날짜도 YYYY-MM-DD로, include_notes는 true일 때만 true', () => {
  const response = buildReportResponse({
    id: '1', period_type: 'this_month', period_from: new Date('2026-11-01T00:00:00.000Z'), period_to: new Date('2026-12-01T00:00:00.000Z'),
    include_notes: null, stats: {}, report: {}, created_at: '2026-11-14T00:00:00.000Z',
  });
  assert.equal(response.period.from, '2026-11-01');
  assert.equal(response.period.label, '2026-11');
  assert.equal(response.include_notes, false);
});
