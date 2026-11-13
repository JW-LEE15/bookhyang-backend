// test/commentSummaryRoutes.test.js: POST /api/ai/comment-summary 라우트 (실제 Express 라우터와 횟수 제한 + 가짜 pool·가짜 AI, DB·네트워크·.env 사용 없음)
// db.js와 services/ai/index.js(Gemini 호출)를 require 캐시에서 가짜로 바꾼 뒤 routes/ai.js를 불러온다.
// 횟수 제한은 사용자 id별이므로 테스트마다 다른 사용자와 다른 ISBN을 쓴다. (요약 캐시도 ISBN별이라 서로 섞이지 않는다)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-for-comment-summary-routes-0123456789';

const SECRET = '비밀-댓글-원문-SENTINEL';
const LEAK_UID = 'LEAK-USER-ID-0000';
const LEAK_NICK = 'LEAK-NICKNAME';

// ---- 가짜 pool: ISBN 뒤 4자리 9999는 댓글 3개(5개 미만), 나머지는 원댓글 6개. includeSpoilers면 스포일러 1개 추가 ----
const state = { poolError: null, queries: [] };
const rootRows = (includeSpoilers) => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: String(500 - i), content: `${SECRET} ${i + 1}`, created_at: '2026-11-12T00:00:00.000Z', is_spoiler: false,
    user_id: LEAK_UID, nickname: LEAK_NICK, // 조회 함수가 버려야 하는 필드
  }));
  if (includeSpoilers) {
    rows.push({ id: '600', content: `${SECRET} 스포일러`, created_at: '2026-11-12T00:00:00.000Z', is_spoiler: true, user_id: LEAK_UID, nickname: LEAK_NICK });
  }
  return rows;
};
const fakePool = {
  query: async (sql, params) => {
    state.queries.push(params);
    if (state.poolError) throw state.poolError;
    if (/WITH roots/.test(sql)) return { rows: [] }; // 답글 쿼리
    const [isbn, includeSpoilers] = params;
    if (isbn.endsWith('9999')) return { rows: rootRows(false).slice(0, 3) };
    return { rows: rootRows(includeSpoilers) };
  },
};
const dbPath = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

// ---- 가짜 AI ----
const fakeAi = {
  calls: [],
  assertError: null,
  generateError: null,
  text: JSON.stringify({
    main_opinions: [{ text: '여러 독자가 비슷한 의견을 냈습니다.', evidence_ids: ['c1', 'c2'] }],
    differing_opinions: [],
    reader_questions: [],
  }),
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
const { signToken } = require('../config/auth');
const { AiError } = require('../services/ai/errors');

const app = express();
app.use(express.json());
app.use('/api/ai', aiRouter);
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/ai`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

let counter = 0;
const nextUser = () => { counter += 1; return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`; };
// 테스트 전용 ISBN. 뒤 4자리 9999(5개 미만)와 겹치지 않는다.
let isbnCounter = 0;
const nextIsbn = () => { isbnCounter += 1; return `979000${String(isbnCounter).padStart(7, '0')}`; };

const post = async (urlPath, { token, body, raw } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST', headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const summary = (token, body) => post('/comment-summary', { token, body });

const reset = () => {
  fakeAi.calls.length = 0;
  fakeAi.assertError = null;
  fakeAi.generateError = null;
  state.poolError = null;
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

test('토큰이 없거나 잘못되면 401이고 AI도 DB도 부르지 않는다', async () => {
  reset();
  for (const token of [undefined, 'not-a-token']) {
    const { status, body } = await summary(token, { isbn: nextIsbn() });
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal('code' in body, false);
  }
  assert.equal(fakeAi.calls.length, 0);
  assert.equal(state.queries.length, 0);
});

// ---- 입력 검증 ----

test('잘못된 입력은 400 BAD_REQUEST', async () => {
  reset();
  const bad = [
    {}, { isbn: '123' }, { isbn: 9790000000019 }, { isbn: '9790000000019', includeSpoilers: 'true' },
    { isbn: '9790000000019', refresh: 1 }, [],
  ];
  for (const body of bad) {
    // 400도 횟수 제한을 소비하므로 요청마다 다른 사용자를 쓴다
    const { status, body: out } = await summary(signToken(nextUser()), body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(out.success, false);
    assert.equal(out.code, 'BAD_REQUEST');
    assert.equal(typeof out.message, 'string');
  }
  assert.equal((await post('/comment-summary', { token: signToken(nextUser()) })).status, 400); // body 없음
  assert.equal(fakeAi.calls.length, 0);
  assert.equal(state.queries.length, 0);
});

// ---- 정상 ----

test('정상: 200, 계약 모양, 닉네임·user_id·댓글 원문이 응답에 없다 (근거 미리보기 제외)', async () => {
  reset();
  const token = signToken(nextUser());
  const isbn = nextIsbn();
  const { status, body } = await summary(token, { isbn });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  const { data } = body;
  assert.deepEqual(Object.keys(data), ['isbn', 'includeSpoilers', 'cached', 'generatedAt', 'counts', 'summary', 'comments']);
  assert.equal(data.isbn, isbn);
  assert.equal(data.includeSpoilers, false);
  assert.equal(data.cached, false);
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
  assert.deepEqual(data.counts, { total: 6, roots: 6, replies: 0 });
  assert.deepEqual(Object.keys(data.summary), ['main_opinions', 'differing_opinions', 'reader_questions']);
  // 최신 원댓글(id 500)부터 담기지만 스레드는 오래된 순이라 c1은 가장 작은 id(495)다
  assert.deepEqual(data.summary.main_opinions[0].evidence_ids, ['495', '496']);
  assert.deepEqual(data.comments.map((c) => c.id), ['495', '496']);
  assert.deepEqual(Object.keys(data.comments[0]), ['id', 'parent_id', 'created_at', 'is_spoiler', 'preview']);
  const text = JSON.stringify(body);
  assert.ok(!text.includes(LEAK_UID) && !text.includes(LEAK_NICK));
  assert.equal(fakeAi.calls.length, 1);
  const sent = JSON.stringify(fakeAi.calls[0]);
  assert.ok(!sent.includes(LEAK_UID) && !sent.includes(LEAK_NICK));
});

test('같은 요청을 다시 보내면 cached:true이고 AI를 부르지 않는다. refresh:true면 다시 부른다', async () => {
  reset();
  const token = signToken(nextUser());
  const isbn = nextIsbn();
  const first = await summary(token, { isbn });
  const second = await summary(token, { isbn });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.cached, true);
  assert.equal(second.body.data.generatedAt, first.body.data.generatedAt);
  assert.equal(fakeAi.calls.length, 1);
  const refreshed = await summary(token, { isbn, refresh: true });
  assert.equal(refreshed.body.data.cached, false);
  assert.equal(fakeAi.calls.length, 2);
});

test('다른 사용자가 같은 책을 요청해도 캐시를 공유한다', async () => {
  reset();
  const isbn = nextIsbn();
  await summary(signToken(nextUser()), { isbn });
  const other = await summary(signToken(nextUser()), { isbn });
  assert.equal(other.body.data.cached, true);
  assert.equal(fakeAi.calls.length, 1);
});

test('includeSpoilers:true는 조회 인자로 전달되고 응답에 에코되며 스포일러 댓글이 포함된다', async () => {
  reset();
  const token = signToken(nextUser());
  const isbn = nextIsbn();
  const off = await summary(token, { isbn });
  const on = await summary(token, { isbn, includeSpoilers: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.data.includeSpoilers, true);
  assert.equal(on.body.data.cached, false); // 키가 달라서 따로 만든다
  assert.equal(off.body.data.counts.total, 6);
  assert.equal(on.body.data.counts.total, 7);
  assert.deepEqual(state.queries[0].slice(0, 2), [isbn, false]);
  assert.deepEqual(state.queries[2].slice(0, 2), [isbn, true]);
});

// ---- 5개 미만 ----

test('댓글이 5개 미만이면 422 NOT_ENOUGH_COMMENTS이고 AI를 부르지 않는다', async () => {
  reset();
  const token = signToken(nextUser());
  const { status, body } = await summary(token, { isbn: '9790000009999' });
  assert.equal(status, 422);
  assert.deepEqual(Object.keys(body), ['success', 'code', 'message']);
  assert.equal(body.success, false);
  assert.equal(body.code, 'NOT_ENOUGH_COMMENTS');
  assert.equal(fakeAi.calls.length, 0);
});

// ---- AI 오류 ----

test('AI 공통 오류 코드는 그대로 { success:false, code, message }와 정해진 상태 코드로 나간다', async () => {
  const cases = [
    ['AI_BUSY', 429], ['AI_UNAVAILABLE', 503], ['AI_TIMEOUT', 504], ['AI_BAD_OUTPUT', 502],
  ];
  for (const [code, expectedStatus] of cases) {
    reset();
    fakeAi.generateError = new AiError(code, { reason: 'test' });
    const { status, body } = await summary(signToken(nextUser()), { isbn: nextIsbn() });
    assert.equal(status, expectedStatus, code);
    assert.deepEqual(Object.keys(body), ['success', 'code', 'message']);
    assert.equal(body.success, false);
    assert.equal(body.code, code);
    assert.equal(typeof body.message, 'string');
  }
});

test('AI를 쓸 수 없는 상태(assertAvailable 실패)는 캐시 miss일 때만 오류이고 hit이면 요약을 준다', async () => {
  reset();
  const token = signToken(nextUser());
  const cachedIsbn = nextIsbn();
  await summary(token, { isbn: cachedIsbn });
  fakeAi.assertError = new AiError('AI_UNAVAILABLE', { reason: 'not-configured' });
  const hit = await summary(token, { isbn: cachedIsbn });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.data.cached, true);
  const miss = await summary(token, { isbn: nextIsbn() });
  assert.equal(miss.status, 503);
  assert.equal(miss.body.code, 'AI_UNAVAILABLE');
});

test('모델 출력이 깨지면 502 AI_BAD_OUTPUT이고 다음 요청은 다시 시도한다 (실패는 캐시하지 않음)', async () => {
  reset();
  const token = signToken(nextUser());
  const isbn = nextIsbn();
  const goodText = fakeAi.text;
  fakeAi.text = 'not json';
  const bad = await summary(token, { isbn });
  assert.equal(bad.status, 502);
  assert.equal(bad.body.code, 'AI_BAD_OUTPUT');
  fakeAi.text = goodText;
  const retry = await summary(token, { isbn });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.cached, false);
});

test('주요 의견이 비고 질문만 있어도 200이고, 세 목록이 모두 비면 502 AI_BAD_OUTPUT', async () => {
  reset();
  const original = fakeAi.text;
  try {
    fakeAi.text = JSON.stringify({
      main_opinions: [], differing_opinions: [], reader_questions: [{ text: '질문입니다.', evidence_ids: ['c1'] }],
    });
    const ok = await summary(signToken(nextUser()), { isbn: nextIsbn() });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data.summary.main_opinions, []);
    assert.equal(ok.body.data.summary.reader_questions.length, 1);
    assert.equal(ok.body.data.comments.length, 1);

    fakeAi.text = JSON.stringify({ main_opinions: [], differing_opinions: [], reader_questions: [] });
    const bad = await summary(signToken(nextUser()), { isbn: nextIsbn() });
    assert.equal(bad.status, 502);
    assert.equal(bad.body.code, 'AI_BAD_OUTPUT');
  } finally {
    fakeAi.text = original;
  }
});

test('DB 오류는 500 INTERNAL_ERROR이고 로그에 댓글 원문과 오류 메시지가 없다', async () => {
  reset();
  state.poolError = Object.assign(new Error(`conn failed ${SECRET}`), { code: '57P01' });
  let result;
  const logs = await captureConsole(async () => {
    result = await summary(signToken(nextUser()), { isbn: nextIsbn() });
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.success, false);
  assert.equal(result.body.code, 'INTERNAL_ERROR');
  assert.ok(!logs.includes(SECRET) && !logs.includes('conn failed'));
  assert.match(logs, /name=Error dbCode=57P01/);
  assert.equal(fakeAi.calls.length, 0);
});

// ---- 로그 ----

test('정상 요청의 서버 로그에 댓글 원문·닉네임·user_id가 없다', async () => {
  reset();
  const logs = await captureConsole(async () => {
    const token = signToken(nextUser());
    const isbn = nextIsbn();
    await summary(token, { isbn });
    await summary(token, { isbn });
  });
  assert.match(logs, /\[AI\] 댓글 요약 완료 comments=6/);
  assert.match(logs, /\[AI\] 댓글 요약 재사용 comments=6/);
  for (const secret of [SECRET, LEAK_UID, LEAK_NICK]) assert.ok(!logs.includes(secret), secret);
});

// ---- 횟수 제한 ----

test('사용자별 분당 5회를 넘으면 429 RATE_LIMITED이고, 추천 API와 한도를 공유한다 (캐시 hit도 센다)', async () => {
  reset();
  const userId = nextUser();
  const token = signToken(userId);
  const isbn = nextIsbn();
  for (let i = 0; i < 5; i += 1) {
    const { status } = await summary(token, { isbn });
    assert.equal(status, 200, `${i + 1}번째`);
  }
  assert.equal(fakeAi.calls.length, 1); // 나머지 4번은 캐시 hit
  const sixth = await summary(token, { isbn });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.code, 'RATE_LIMITED');
  // 같은 사용자의 추천 요청도 같은 한도에 걸린다
  const recommend = await post('/recommend', { token, body: {} });
  assert.equal(recommend.status, 429);
  assert.equal(recommend.body.code, 'RATE_LIMITED');
  // 다른 사용자는 영향이 없다
  const other = await summary(signToken(nextUser()), { isbn });
  assert.equal(other.status, 200);
});

test('400 요청도 횟수 제한을 소비한다 (제한이 입력 검증보다 앞)', async () => {
  reset();
  const token = signToken(nextUser());
  for (let i = 0; i < 5; i += 1) assert.equal((await summary(token, {})).status, 400);
  const sixth = await summary(token, {});
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.code, 'RATE_LIMITED');
});
