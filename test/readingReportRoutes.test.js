// test/readingReportRoutes.test.js: POST /api/ai/reading-report, GET·DELETE /api/reading-reports
// 실제 Express 라우터·횟수 제한·서비스·저장소 SQL 흐름 + 메모리 가짜 pool·가짜 AI (DB·네트워크·.env 사용 없음)
// db.js와 services/ai/index.js(Gemini 호출)를 require 캐시에서 가짜로 바꾼 뒤 라우터를 불러온다.
// 횟수 제한은 사용자 id별이므로 테스트마다 다른 사용자를 쓴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-for-reading-report-routes-0123456789';

const NOTE_SECRET = '비밀-메모-원문-SENTINEL';
const TITLE_SECRET = '비밀-책-제목-SENTINEL';

// ---- 가짜 pool: SQL 모양을 알아보고 메모리 표를 읽고 쓴다 ----
const state = {
  poolError: null,
  insertError: null,
  completedRows: [{ category: '소설', n: '2' }, { category: null, n: '1' }], // 기간 안 완독 3권
  queries: [],
  reports: [], // { id, user_id, period_type, ..., created_at }
  nextId: 100,
};
const bookRows = [
  { id: 1, title: TITLE_SECRET, author: '저자 A' },
  { id: 2, title: '변신', author: '저자 B' },
  { id: 3, title: '이방인', author: '저자 C' },
];
const noteRows = [
  { id: '9007199254740993', title: TITLE_SECRET, content: `${NOTE_SECRET} 하나` },
  { id: '9007199254740994', title: '변신', content: `${NOTE_SECRET} 둘` },
];
const OUTPUT_COLUMNS = ['id', 'period_type', 'period_from', 'period_to', 'include_notes', 'stats', 'report', 'created_at'];
const pick = (row) => Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, row[column]]));

const fakePool = {
  query: async (sql, params) => {
    state.queries.push({ sql, params });
    if (state.poolError) throw state.poolError;
    if (/GROUP BY b\.category/.test(sql)) return { rows: state.completedRows };
    if (/FROM user_books\s+WHERE user_id = \$1 AND status = 'COMPLETED'/.test(sql)) return { rows: bookRows };
    if (/SELECT COUNT\(\*\) AS n\s+FROM reading_notes/.test(sql)) return { rows: [{ n: String(noteRows.length) }] };
    if (/ORDER BY n\.created_at DESC/.test(sql)) return { rows: noteRows };
    if (/INSERT INTO reading_reports/.test(sql)) {
      if (state.insertError) throw state.insertError;
      const [userId, periodType, from, to, includeNotes, stats, report] = params;
      const row = {
        id: String((state.nextId += 1)), user_id: userId, period_type: periodType, period_from: from, period_to: to,
        include_notes: includeNotes, stats: JSON.parse(stats), report: JSON.parse(report), created_at: new Date('2026-11-14T00:00:00.000Z'),
      };
      state.reports.push(row);
      return { rows: [pick(row)], rowCount: 1 };
    }
    if (/FROM reading_reports\s+WHERE user_id = \$1/.test(sql)) {
      const rows = state.reports.filter((row) => row.user_id === params[0]).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, params[1]);
      return { rows: rows.map(pick) };
    }
    if (/DELETE FROM reading_reports/.test(sql)) {
      const index = state.reports.findIndex((row) => row.id === params[0] && row.user_id === params[1]);
      if (index === -1) return { rows: [], rowCount: 0 };
      state.reports.splice(index, 1);
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
  },
};
const dbPath = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

// ---- 가짜 AI ----
const GOOD_TEXT = JSON.stringify({
  interest_topics: [{ text: '고독과 소외를 다룬 책을 읽었습니다.', evidence_ids: ['b1', 'b2'] }],
  repeated_thoughts: [{ text: '타인과의 거리에 대한 생각이 반복됩니다.', evidence_ids: ['n1', 'n2'] }],
  reflection_questions: [{ text: '나는 언제 가장 나답다고 느꼈나요?', evidence_ids: ['n1'] }],
  next_reading: [{ text: '관계와 고립을 다룬 작품을 읽어 보세요.', evidence_ids: ['b1'] }],
});
const fakeAi = {
  calls: [],
  assertError: null,
  generateError: null,
  text: GOOD_TEXT,
  assertAvailable() { if (fakeAi.assertError) throw fakeAi.assertError; },
  async generateJson(prompt) {
    fakeAi.calls.push(prompt);
    if (fakeAi.generateError) throw fakeAi.generateError;
    return fakeAi.text;
  },
};
const aiPath = require.resolve(path.join(__dirname, '..', 'services', 'ai', 'index.js'));
require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: fakeAi };

const aiRouter = require('../routes/ai');
const readingReportsRouter = require('../routes/readingReports');
const { signToken } = require('../config/auth');
const { AiError } = require('../services/ai/errors');

const app = express();
app.use(express.json());
app.use('/api/ai', aiRouter);
app.use('/api/reading-reports', readingReportsRouter);
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

let counter = 0;
const nextUser = () => { counter += 1; return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`; };

const call = async (method, urlPath, { token, body, raw } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text); // 깨진 JSON 요청에는 테스트 앱의 기본 오류 페이지(HTML)가 온다
  } catch {
    // JSON이 아니면 body는 null
  }
  return { status: res.status, body: json };
};
const makeReport = (token, body) => call('POST', '/api/ai/reading-report', { token, body });
const listReports = (token) => call('GET', '/api/reading-reports', { token });
const removeReport = (token, id) => call('DELETE', `/api/reading-reports/${id}`, { token });

const reset = () => {
  fakeAi.calls.length = 0;
  fakeAi.assertError = null;
  fakeAi.generateError = null;
  fakeAi.text = GOOD_TEXT;
  state.poolError = null;
  state.insertError = null;
  state.completedRows = [{ category: '소설', n: '2' }, { category: null, n: '1' }];
  state.queries.length = 0;
};

// 콘솔 출력을 모아서 돌려준다
const captureConsole = async (fn) => {
  const captured = [];
  const originals = {};
  for (const name of ['log', 'warn', 'error', 'info']) {
    originals[name] = console[name];
    console[name] = (...args) => captured.push(args.map(String).join(' '));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, originals);
  }
  return captured.join('\n');
};

// ---- 인증 ----

test('토큰이 없거나 잘못되면 세 경로 모두 401이고 AI도 DB도 부르지 않는다', async () => {
  reset();
  for (const token of [undefined, 'not-a-token']) {
    assert.equal((await makeReport(token, { period: 'this_month' })).status, 401);
    assert.equal((await listReports(token)).status, 401);
    assert.equal((await removeReport(token, '1')).status, 401);
  }
  assert.equal(fakeAi.calls.length, 0);
  assert.equal(state.queries.length, 0);
});

// ---- 입력 검증 ----

test('잘못된 입력은 400 BAD_REQUEST이고 AI도 DB도 부르지 않는다', async () => {
  reset();
  const freshToken = () => signToken(nextUser()); // 분당 5회 제한에 걸리지 않도록 요청마다 다른 사용자
  const bad = [
    undefined, {}, { period: 'custom' }, { period: 'THIS_MONTH' }, { period: 5 },
    { period: 'this_month', includeNotes: 'yes' }, { period: 'this_month', includeNotes: 1 }, { period: 'this_month', includeNotes: null },
  ];
  for (const body of bad) {
    const { status, body: json } = await makeReport(freshToken(), body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.code, 'BAD_REQUEST');
    assert.equal(json.success, false);
  }
  const broken = await call('POST', '/api/ai/reading-report', { token: freshToken(), raw: '{깨진 json' });
  assert.equal(broken.status >= 400 && broken.status < 500, true);
  assert.equal(fakeAi.calls.length, 0);
  assert.equal(state.queries.length, 0);
});

// ---- 기록 부족 ----

test('완독 1권이면 422 NOT_ENOUGH_RECORDS이고 AI를 부르지 않고 저장하지 않는다', async () => {
  reset();
  state.completedRows = [{ category: null, n: '1' }];
  const token = signToken(nextUser());
  const { status, body } = await makeReport(token, { period: 'last_month' });
  assert.equal(status, 422);
  assert.equal(body.code, 'NOT_ENOUGH_RECORDS');
  assert.equal(body.success, false);
  assert.equal(fakeAi.calls.length, 0);
  assert.equal(state.queries.some((q) => /INSERT/.test(q.sql)), false);
});

// ---- 생성 ----

test('includeNotes 없이 생성: 200, Report 모양, 메모 쿼리 없음, 프롬프트에 메모 없음', async () => {
  reset();
  const userId = nextUser();
  const token = signToken(userId);
  const { status, body } = await makeReport(token, { period: 'this_month' });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  const data = body.data;
  assert.match(data.id, /^[0-9]+$/);
  assert.equal(data.period.type, 'this_month');
  assert.match(data.period.label, /^\d{4}-\d{2}$/);
  assert.match(data.period.from, /^\d{4}-\d{2}-01$/);
  assert.equal(data.include_notes, false);
  assert.equal(data.stats.completed_count, 3);
  assert.equal(data.stats.notes_count, 2);
  assert.deepEqual(data.stats.by_category, [{ category: '소설', count: 2 }, { category: null, count: 1 }]);
  assert.deepEqual(data.stats.ai_input, { books_sent: 3, notes_sent: 0 });
  assert.deepEqual(Object.keys(data.report), ['interest_topics', 'repeated_thoughts', 'reflection_questions', 'next_reading']);
  assert.deepEqual(data.report.repeated_thoughts, []);
  assert.deepEqual(data.report.interest_topics[0].evidence.book_ids, ['1', '2']);

  assert.equal(state.queries.some((q) => /ORDER BY n\.created_at DESC/.test(q.sql)), false, '메모 목록 쿼리를 실행하지 않아야 한다');
  assert.ok(!fakeAi.calls[0].userText.includes(NOTE_SECRET));
  assert.ok(!JSON.stringify(body).includes(userId)); // 사용자 id는 응답에 없다
});

test('includeNotes=true로 생성: 메모가 AI 입력에 들어가고 근거 id가 되돌아온다. 응답·저장·로그에 원문은 없다', async () => {
  reset();
  const token = signToken(nextUser());
  let response;
  const logged = await captureConsole(async () => {
    response = await makeReport(token, { period: 'last_month', includeNotes: true });
  });
  assert.equal(response.status, 200);
  const data = response.body.data;
  assert.equal(data.include_notes, true);
  assert.equal(data.period.type, 'last_month');
  assert.deepEqual(data.stats.ai_input, { books_sent: 3, notes_sent: 2 });
  assert.deepEqual(data.report.repeated_thoughts[0].evidence.note_ids, ['9007199254740993', '9007199254740994']);

  assert.ok(fakeAi.calls[0].userText.includes(NOTE_SECRET));
  const insert = state.queries.find((q) => /INSERT INTO reading_reports/.test(q.sql));
  assert.ok(!JSON.stringify(insert.params).includes(NOTE_SECRET));
  assert.ok(!JSON.stringify(response.body).includes(NOTE_SECRET));
  assert.ok(!logged.includes(NOTE_SECRET) && !logged.includes(TITLE_SECRET));
  assert.match(logged, /\[AI\] 독서 리포트 완료/);
});

// ---- 저장, 목록, 삭제, 소유자 ----

test('생성하면 목록에 보이고, 남의 목록에는 없고, 남은 지울 수 없고, 내가 지우면 사라진다', async () => {
  reset();
  const owner = signToken(nextUser());
  const other = signToken(nextUser());
  const created = (await makeReport(owner, { period: 'this_month' })).body.data;

  const mine = await listReports(owner);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.data.map((r) => r.id), [created.id]);
  assert.deepEqual(mine.body.data[0], created); // 생성 응답과 목록 항목의 모양이 같다
  assert.deepEqual((await listReports(other)).body.data, []);

  const stolen = await removeReport(other, created.id);
  assert.equal(stolen.status, 404);
  assert.equal(stolen.body.success, false);
  assert.equal((await listReports(owner)).body.data.length, 1, '남이 지우려 해도 남아 있어야 한다');

  const deleted = await removeReport(owner, created.id);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.success, true);
  assert.deepEqual((await listReports(owner)).body.data, []);

  const again = await removeReport(owner, created.id);
  assert.equal(again.status, 404);
  assert.deepEqual(again.body, stolen.body); // 남의 것과 없는 것은 똑같은 응답
});

test('목록은 최신순이다', async () => {
  reset();
  const token = signToken(nextUser());
  const first = (await makeReport(token, { period: 'this_month' })).body.data;
  const second = (await makeReport(token, { period: 'last_month' })).body.data;
  assert.deepEqual((await listReports(token)).body.data.map((r) => r.id), [second.id, first.id]);
});

test('잘못된 id 삭제는 DB를 부르지 않고 404', async () => {
  reset();
  const token = signToken(nextUser());
  for (const id of ['abc', '0', '-1', '1e3', '01', '99999999999999999999', '1.5']) {
    const { status } = await removeReport(token, id);
    assert.equal(status, 404, id);
  }
  assert.equal(state.queries.length, 0);
});

// ---- 오류 응답 ----

test('AI 오류는 각자의 상태 코드와 code로 응답하고 저장하지 않는다', async () => {
  const cases = [
    ['AI_UNAVAILABLE', 503], ['AI_TIMEOUT', 504], ['AI_BUSY', 429], ['AI_BAD_OUTPUT', 502],
  ];
  for (const [code, expected] of cases) {
    reset();
    const token = signToken(nextUser());
    fakeAi.generateError = new AiError(code, { reason: 'test' });
    const { status, body } = await makeReport(token, { period: 'this_month' });
    assert.equal(status, expected, code);
    assert.equal(body.code, code);
    assert.equal(state.queries.some((q) => /INSERT/.test(q.sql)), false, code);
  }
});

test('AI를 쓸 수 없으면(assertAvailable) 503이고 입력 조회도 하지 않는다', async () => {
  reset();
  const token = signToken(nextUser());
  fakeAi.assertError = new AiError('AI_UNAVAILABLE', { reason: 'not-configured' });
  const { status, body } = await makeReport(token, { period: 'this_month' });
  assert.equal(status, 503);
  assert.equal(body.code, 'AI_UNAVAILABLE');
  assert.equal(state.queries.some((q) => /FROM user_books\s+WHERE/.test(q.sql)), false);
  assert.equal(fakeAi.calls.length, 0);
});

test('AI 출력이 검증을 통과하지 못하면 502 AI_BAD_OUTPUT이고 저장하지 않는다', async () => {
  reset();
  const token = signToken(nextUser());
  fakeAi.text = '이건 JSON이 아님';
  const { status, body } = await makeReport(token, { period: 'this_month' });
  assert.equal(status, 502);
  assert.equal(body.code, 'AI_BAD_OUTPUT');
  assert.equal(state.queries.some((q) => /INSERT/.test(q.sql)), false);
});

test('DB 오류는 500 INTERNAL_ERROR이고 응답과 로그에 오류 내용이 새지 않는다', async () => {
  reset();
  const token = signToken(nextUser());
  state.insertError = Object.assign(new Error(`insert 실패 ${NOTE_SECRET}`), { code: '08006' });
  let response;
  const logged = await captureConsole(async () => {
    response = await makeReport(token, { period: 'this_month', includeNotes: true });
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(response.body).includes(NOTE_SECRET));
  assert.ok(!logged.includes(NOTE_SECRET));
  assert.match(logged, /dbCode=08006/);
});

test('목록·삭제의 DB 오류는 500이고 로그에는 이름과 DB 오류 코드만 남는다', async () => {
  reset();
  const token = signToken(nextUser());
  state.poolError = Object.assign(new Error(`쿼리 실패 ${NOTE_SECRET}`), { code: '57P01' });
  let list;
  let del;
  const logged = await captureConsole(async () => {
    list = await listReports(token);
    del = await removeReport(token, '5');
  });
  assert.equal(list.status, 500);
  assert.equal(del.status, 500);
  assert.ok(!JSON.stringify([list.body, del.body]).includes(NOTE_SECRET));
  assert.ok(!logged.includes(NOTE_SECRET));
  assert.match(logged, /dbCode=57P01/);
});

// ---- 횟수 제한 ----

test('같은 사용자가 1분에 6번째 요청을 하면 429 RATE_LIMITED이고 다른 사용자는 영향이 없다', async () => {
  reset();
  const token = signToken(nextUser());
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await makeReport(token, {})).status, 400); // 검증 실패도 횟수에 포함된다 (제한이 검증보다 먼저)
  }
  const limited = await makeReport(token, { period: 'this_month' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  assert.equal(fakeAi.calls.length, 0);

  const other = signToken(nextUser());
  assert.equal((await makeReport(other, { period: 'this_month' })).status, 200);
});
