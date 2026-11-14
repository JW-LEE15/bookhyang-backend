// test/commentLikesReports.test.js: 댓글 하트·신고 (가짜 pool, 실제 Express 라우터, DB·.env 사용 없음)
// 쿼리 문장은 실제 DB에서 실행해 보지 않았다. 여기서는 호출 방식(파라미터, 조건 문구), 결과 분류, 응답 모양, 로그를 확인한다.
// 실제 DB 확인은 scripts/test-comment-likes-reports.ps1
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-for-comment-likes-reports-0123456789';

const AUTHOR = '11111111-1111-1111-1111-111111111111';
const SECRET_DETAIL = '신고-상세-원문-SENTINEL';

// 테스트마다 handler(sql, params)를 바꿔 끼운다. calls에는 호출 기록이 쌓인다.
let handler = () => ({ rows: [] });
let calls = [];
const fakePool = {
  query: async (sql, params) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    if (out instanceof Error) throw out;
    return { rowCount: out.rows ? out.rows.length : 0, rows: out.rows || [] };
  },
};
const dbPath = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };
const commentsRouter = require('../routes/comments');
const commentsService = require('../services/comments');
const { signToken } = require('../config/auth');
const { LIKE_LIMIT_OPTIONS, REPORT_LIMIT_OPTIONS } = require('../middleware/commentLimiters');
const { userKeyGenerator } = require('../middleware/aiLimiters');
const { validateReportBody } = require('../validators/commentValidator');

// 사용자별 횟수 제한이 테스트끼리 섞이지 않게 테스트마다 새 사용자를 쓴다
let userSeq = 0;
const newUser = () => `00000000-0000-4000-8000-${String(++userSeq).padStart(12, '0')}`;

const app = express();
app.use(express.json());
app.use('/api/comments', commentsRouter);
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/comments`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { calls = []; handler = () => ({ rows: [] }); });

const call = async (method, urlPath, { userId, token, body } = {}) => {
  const headers = {};
  const t = token === undefined && userId ? signToken(userId) : token;
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

// 하트 쿼리용 handler: INSERT/DELETE는 빈 결과, 상태 조회는 state 행 (없으면 댓글 없음)
const likeHandler = (state) => (sql) => (/^\s*SELECT c\.user_id/.test(sql) ? { rows: state ? [state] : [] } : { rows: [] });
const state = (overrides = {}) => ({
  user_id: AUTHOR, is_hidden: false, deleted_at: null, like_count: '3', liked_by_me: true, ...overrides,
});
const NOT_FOUND = { success: false, message: '댓글을 찾을 수 없습니다.' };

// ---- 서비스: likeComment ----

test('서비스 하트: 조건이 INSERT 문장 안에 있고 파라미터가 맞다', async () => {
  handler = likeHandler(state());
  const me = newUser();
  const out = await commentsService.likeComment(fakePool, { userId: me, id: '10' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ['10', me]);
  for (const condition of ['c.deleted_at IS NULL', 'c.user_id <> $2::uuid', 'NOT c.is_hidden', 'ON CONFLICT (comment_id, user_id) DO NOTHING']) {
    assert.ok(calls[0].sql.includes(condition), condition);
  }
  assert.deepEqual(calls[1].params, ['10', me]);
  assert.deepEqual(out, { result: 'ok', data: { comment_id: '10', like_count: 3, liked_by_me: true } });
});

test('서비스 하트 분류: 없음·삭제 > 본인 > 숨김', async () => {
  const me = newUser();
  const cases = [
    ['댓글 없음', undefined, 'not_found'],
    ['삭제 표시', state({ deleted_at: '2026-11-12' }), 'not_found'],
    ['삭제 표시이면서 본인·숨김이어도 not_found', state({ deleted_at: '2026-11-12', user_id: me, is_hidden: true }), 'not_found'],
    ['본인 댓글', state({ user_id: me }), 'own_comment'],
    ['본인이면서 숨김이면 본인이 먼저', state({ user_id: me, is_hidden: true }), 'own_comment'],
    ['타인의 숨김 댓글', state({ is_hidden: true }), 'not_found'],
  ];
  for (const [name, row, expected] of cases) {
    handler = likeHandler(row);
    const out = await commentsService.likeComment(fakePool, { userId: me, id: '10' });
    assert.equal(out.result, expected, name);
  }
});

test('서비스 하트: FK 위반(그 사이 댓글 삭제)은 not_found, 다른 오류는 그대로 던진다', async () => {
  handler = () => Object.assign(new Error('x'), { code: '23503' });
  assert.deepEqual(await commentsService.likeComment(fakePool, { userId: newUser(), id: '10' }), { result: 'not_found' });
  const boom = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  handler = () => boom;
  await assert.rejects(commentsService.likeComment(fakePool, { userId: newUser(), id: '10' }), (error) => error === boom);
});

// ---- 서비스: unlikeComment ----

test('서비스 하트 취소: 삭제 표시 댓글은 건드리지 않는 조건이 있고, 본인·숨김 댓글도 허용한다', async () => {
  const me = newUser();
  handler = likeHandler(state({ user_id: me, is_hidden: true, liked_by_me: false, like_count: '0' }));
  const out = await commentsService.unlikeComment(fakePool, { userId: me, id: '10' });
  assert.match(calls[0].sql, /DELETE FROM comment_likes/);
  assert.match(calls[0].sql, /c\.deleted_at IS NULL/);
  assert.deepEqual(calls[0].params, ['10', me]);
  assert.deepEqual(out, { result: 'ok', data: { comment_id: '10', like_count: 0, liked_by_me: false } });
});

test('서비스 하트 취소: 없는 댓글과 삭제 표시 댓글만 not_found', async () => {
  handler = likeHandler(undefined);
  assert.deepEqual(await commentsService.unlikeComment(fakePool, { userId: newUser(), id: '10' }), { result: 'not_found' });
  handler = likeHandler(state({ deleted_at: '2026-11-12' }));
  assert.deepEqual(await commentsService.unlikeComment(fakePool, { userId: newUser(), id: '10' }), { result: 'not_found' });
});

// ---- 서비스: reportComment ----

test('서비스 신고: 조건이 INSERT 문장 안에 있고 파라미터가 맞다', async () => {
  handler = () => ({ rows: [{ id: '1' }] });
  const me = newUser();
  const out = await commentsService.reportComment(fakePool, { userId: me, id: '10', reason: 'spam', detail: '상세' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['10', me, 'spam', '상세']);
  for (const condition of ['c.deleted_at IS NULL', 'c.user_id <> $2::uuid', 'ON CONFLICT (comment_id, reporter_id) DO NOTHING']) {
    assert.ok(calls[0].sql.includes(condition), condition);
  }
  assert.equal(calls[0].sql.includes('is_hidden'), false); // 숨김 댓글도 신고할 수 있다
  assert.deepEqual(out, { result: 'ok' }); // 신고자·신고 id를 돌려주지 않는다
});

test('서비스 신고 분류: 0행이면 이유를 구분한다 (없음·삭제 > 본인 > 이미 신고)', async () => {
  const me = newUser();
  const cases = [
    ['댓글 없음', [], 'not_found'],
    ['삭제 표시', [{ user_id: AUTHOR, deleted_at: '2026-11-12' }], 'not_found'],
    ['본인 댓글', [{ user_id: me, deleted_at: null }], 'own_comment'],
    ['이미 신고', [{ user_id: AUTHOR, deleted_at: null }], 'already_reported'],
  ];
  for (const [name, rows, expected] of cases) {
    calls = [];
    handler = (sql) => (/INSERT/.test(sql) ? { rows: [] } : { rows });
    const out = await commentsService.reportComment(fakePool, { userId: me, id: '10', reason: 'spam' });
    assert.deepEqual(out, { result: expected }, name);
    assert.equal(calls.length, 2, name);
    assert.deepEqual(calls[0].params, ['10', me, 'spam', null], name); // detail 생략은 null
  }
});

test('서비스 신고: FK 위반은 not_found, 다른 오류는 그대로 던진다', async () => {
  handler = () => Object.assign(new Error('x'), { code: '23503' });
  assert.deepEqual(await commentsService.reportComment(fakePool, { userId: newUser(), id: '10', reason: 'spam' }), { result: 'not_found' });
  const boom = Object.assign(new Error('boom'), { code: '23514' });
  handler = () => boom;
  await assert.rejects(commentsService.reportComment(fakePool, { userId: newUser(), id: '10', reason: 'spam' }), (error) => error === boom);
});

test('AI 요약 입력 쿼리는 하트·신고 테이블을 쓰지 않는다', async () => {
  handler = () => ({ rows: [] });
  await commentsService.listCommentsForSummary(fakePool, { isbn: '9790000000019' });
  assert.ok(calls.length > 0);
  for (const { sql } of calls) {
    assert.equal(/comment_likes|comment_reports|like_count/.test(sql), false);
  }
});

// ---- validateReportBody ----

test('신고 body 검증: reason 4가지, detail 선택, 200자(글자 수) 경계', () => {
  for (const reason of ['spam', 'abuse', 'spoiler', 'other']) {
    assert.deepEqual(validateReportBody({ reason }), { ok: true, value: { reason, detail: null } });
  }
  for (const body of [undefined, null, {}, { reason: 'SPAM' }, { reason: 1 }, { reason: 'x' }]) {
    assert.equal(validateReportBody(body).ok, false);
  }
  assert.equal(validateReportBody({ reason: 'other', detail: null }).value.detail, null);
  assert.equal(validateReportBody({ reason: 'other', detail: '   ' }).value.detail, null);
  assert.equal(validateReportBody({ reason: 'other', detail: '  안녕  ' }).value.detail, '안녕');
  assert.equal(validateReportBody({ reason: 'other', detail: '가'.repeat(200) }).ok, true); // 한글 200자 = 600바이트여도 통과
  assert.equal(validateReportBody({ reason: 'other', detail: '😀'.repeat(200) }).ok, true); // 이모지도 1글자
  assert.equal(validateReportBody({ reason: 'other', detail: '가'.repeat(201) }).ok, false);
  assert.equal(validateReportBody({ reason: 'other', detail: 123 }).ok, false);
  assert.equal(validateReportBody({ reason: 'other', detail: ['a'] }).ok, false);
  // 오류 메시지에 입력값이 들어가지 않는다
  assert.equal(JSON.stringify(validateReportBody({ reason: 'other', detail: SECRET_DETAIL.repeat(20) })).includes('SENTINEL'), false);
});

// ---- PUT /api/comments/:id/like ----

test('PUT 하트: 토큰 없음 401, 잘못된 id 404 (DB를 건드리지 않는다)', async () => {
  assert.equal((await call('PUT', '/10/like')).status, 401);
  assert.deepEqual(await call('PUT', '/abc/like', { userId: newUser() }), { status: 404, body: NOT_FOUND });
  assert.equal(calls.length, 0);
});

test('PUT 하트: 본인 댓글은 400 LIKE_OWN_COMMENT, 타인 숨김·삭제 표시·없는 댓글은 같은 404 본문', async () => {
  const me = newUser();
  handler = likeHandler(state({ user_id: me }));
  const own = await call('PUT', '/10/like', { userId: me });
  assert.equal(own.status, 400);
  assert.equal(own.body.success, false);
  assert.equal(own.body.code, 'LIKE_OWN_COMMENT');
  assert.equal(typeof own.body.message, 'string');

  const outs = [];
  for (const row of [state({ is_hidden: true }), state({ deleted_at: '2026-11-12' }), undefined]) {
    handler = likeHandler(row);
    outs.push(await call('PUT', '/10/like', { userId: me }));
  }
  for (const out of outs) assert.deepEqual(out, { status: 404, body: NOT_FOUND });
});

test('PUT 하트: 성공 200 {comment_id, like_count, liked_by_me}, 두 번 눌러도 같은 응답 (멱등)', async () => {
  const me = newUser();
  handler = likeHandler(state());
  const first = await call('PUT', '/10/like', { userId: me });
  const second = await call('PUT', '/10/like', { userId: me });
  assert.deepEqual(first, { status: 200, body: { success: true, data: { comment_id: '10', like_count: 3, liked_by_me: true } } });
  assert.deepEqual(second, first);
});

// ---- DELETE /api/comments/:id/like ----

test('DELETE 하트: 401, 잘못된 id 404, 없거나 삭제 표시된 댓글 404', async () => {
  assert.equal((await call('DELETE', '/10/like')).status, 401);
  const me = newUser();
  assert.deepEqual(await call('DELETE', '/abc/like', { userId: me }), { status: 404, body: NOT_FOUND });
  handler = likeHandler(undefined);
  assert.deepEqual(await call('DELETE', '/10/like', { userId: me }), { status: 404, body: NOT_FOUND });
  handler = likeHandler(state({ deleted_at: '2026-11-12' }));
  assert.deepEqual(await call('DELETE', '/10/like', { userId: me }), { status: 404, body: NOT_FOUND });
});

test('DELETE 하트: 성공 200, 두 번 지워도 같은 응답, 본인·숨김 댓글에도 허용', async () => {
  const me = newUser();
  for (const row of [state({ liked_by_me: false, like_count: '2' }), state({ user_id: me, is_hidden: true, liked_by_me: false, like_count: '2' })]) {
    handler = likeHandler(row);
    const first = await call('DELETE', '/10/like', { userId: me });
    const second = await call('DELETE', '/10/like', { userId: me });
    assert.deepEqual(first, { status: 200, body: { success: true, data: { comment_id: '10', like_count: 2, liked_by_me: false } } });
    assert.deepEqual(second, first);
  }
});

test('/:id 삭제 라우트와 /:id/like 라우트가 서로 섞이지 않는다', async () => {
  handler = () => ({ rows: [{ marked: '0', removed: '1' }] });
  const del = await call('DELETE', '/10', { userId: newUser() });
  assert.deepEqual(del, { status: 200, body: { success: true, message: '댓글이 삭제되었습니다.' } });
});

// ---- POST /api/comments/:id/report ----

test('POST 신고: 401, 잘못된 id 404, 잘못된 body 400 (DB를 건드리지 않는다)', async () => {
  assert.equal((await call('POST', '/10/report', { body: { reason: 'spam' } })).status, 401);
  const me = newUser();
  assert.deepEqual(await call('POST', '/abc/report', { userId: me, body: { reason: 'spam' } }), { status: 404, body: NOT_FOUND });
  assert.equal((await call('POST', '/10/report', { userId: me, body: { reason: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/10/report', { userId: me, body: {} })).status, 400);
  assert.equal((await call('POST', '/10/report', { userId: me })).status, 400);
  assert.equal((await call('POST', '/10/report', { userId: me, body: { reason: 'spam', detail: 5 } })).status, 400);
  const tooLong = await call('POST', '/10/report', { userId: me, body: { reason: 'other', detail: '가'.repeat(201) } });
  assert.equal(tooLong.status, 400);
  assert.equal(calls.length, 0);
});

test('POST 신고: 성공 201, 응답에는 success·message만 (신고자·신고 id·detail 없음)', async () => {
  const me = newUser();
  handler = () => ({ rows: [{ id: '99' }] });
  const out = await call('POST', '/10/report', { userId: me, body: { reason: 'abuse', detail: SECRET_DETAIL } });
  assert.deepEqual(out, { status: 201, body: { success: true, message: '신고가 접수되었습니다.' } });
  assert.deepEqual(calls[0].params, ['10', me, 'abuse', SECRET_DETAIL]);
  const text = JSON.stringify(out.body);
  assert.equal(text.includes(me), false);
  assert.equal(text.includes('SENTINEL'), false);
});

test("POST 신고: reason 'other'는 detail 없이도 되고, 한글 200자와 빈 detail 처리", async () => {
  const me = newUser();
  handler = () => ({ rows: [{ id: '1' }] });
  assert.equal((await call('POST', '/10/report', { userId: me, body: { reason: 'other' } })).status, 201);
  assert.equal((await call('POST', '/10/report', { userId: me, body: { reason: 'other', detail: '가'.repeat(200) } })).status, 201);
  assert.equal(calls[1].params[3].length, 200);
  assert.equal((await call('POST', '/10/report', { userId: me, body: { reason: 'spam', detail: '  ' } })).status, 201);
  assert.equal(calls[2].params[3], null);
});

test('POST 신고: 본인 댓글 400 REPORT_OWN_COMMENT, 중복 409 ALREADY_REPORTED, 없는·삭제 표시 404', async () => {
  const me = newUser();
  const body = { reason: 'spam' };
  const run = async (rows) => {
    handler = (sql) => (/INSERT/.test(sql) ? { rows: [] } : { rows });
    return call('POST', '/10/report', { userId: me, body });
  };

  const own = await run([{ user_id: me, deleted_at: null }]);
  assert.equal(own.status, 400);
  assert.equal(own.body.code, 'REPORT_OWN_COMMENT');

  const dup = await run([{ user_id: AUTHOR, deleted_at: null }]);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.success, false);
  assert.equal(dup.body.code, 'ALREADY_REPORTED');

  assert.deepEqual(await run([]), { status: 404, body: NOT_FOUND });
  assert.deepEqual(await run([{ user_id: AUTHOR, deleted_at: '2026-11-12' }]), { status: 404, body: NOT_FOUND });
});

// ---- 횟수 제한 ----

test('limiter 설정: 하트 30/분, 신고 10/시간, 사용자 id 기준', () => {
  assert.equal(LIKE_LIMIT_OPTIONS.limit, 30);
  assert.equal(LIKE_LIMIT_OPTIONS.windowMs, 60 * 1000);
  assert.equal(REPORT_LIMIT_OPTIONS.limit, 10);
  assert.equal(REPORT_LIMIT_OPTIONS.windowMs, 60 * 60 * 1000);
  assert.equal(LIKE_LIMIT_OPTIONS.keyGenerator, userKeyGenerator);
  assert.equal(REPORT_LIMIT_OPTIONS.keyGenerator, userKeyGenerator);
});

test('신고 11번째 요청은 429 RATE_LIMITED (사용자별), 다른 사용자는 영향 없음', async () => {
  const spammer = newUser();
  handler = () => ({ rows: [{ id: '1' }] });
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call('POST', '/10/report', { userId: spammer, body: { reason: 'spam' } })).status, 201);
  }
  const limited = await call('POST', '/10/report', { userId: spammer, body: { reason: 'spam' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  assert.equal((await call('POST', '/10/report', { userId: newUser(), body: { reason: 'spam' } })).status, 201);
});

test('하트 31번째 요청은 429 (PUT·DELETE가 카운터를 공유)', async () => {
  const user = newUser();
  handler = likeHandler(state());
  for (let i = 0; i < 30; i += 1) {
    const out = await call(i % 2 === 0 ? 'PUT' : 'DELETE', '/10/like', { userId: user });
    assert.equal(out.status, 200, `요청 ${i + 1}`);
  }
  const limited = await call('PUT', '/10/like', { userId: user });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
});

test('인증 실패 요청은 횟수 제한을 소모하지 않는다', async () => {
  const user = newUser();
  for (let i = 0; i < 12; i += 1) await call('POST', '/10/report', { body: { reason: 'spam' } }); // 토큰 없음 401
  handler = () => ({ rows: [{ id: '1' }] });
  assert.equal((await call('POST', '/10/report', { userId: user, body: { reason: 'spam' } })).status, 201);
});

// ---- 로그 ----

test('DB 오류가 나면 500이고, 로그와 응답에 detail 원문·사용자 id가 없다', async () => {
  const me = newUser();
  handler = () => Object.assign(new Error(`Failing row contains (${SECRET_DETAIL})`), {
    name: 'error', code: '23514', detail: `Failing row contains (${SECRET_DETAIL}, ${me})`,
  });
  const logged = [];
  const originals = {};
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[method] = console[method];
    console[method] = (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  let outs;
  try {
    outs = [
      await call('POST', '/10/report', { userId: me, body: { reason: 'other', detail: SECRET_DETAIL } }),
      await call('PUT', '/10/like', { userId: me }),
      await call('DELETE', '/10/like', { userId: me }),
    ];
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }
  for (const out of outs) {
    assert.equal(out.status, 500);
    assert.equal(out.body.success, false);
    const text = JSON.stringify(out.body);
    assert.equal(text.includes('SENTINEL'), false);
    assert.equal(text.includes(me), false);
  }
  assert.equal(logged.length, 3);
  for (const line of logged) {
    assert.match(line, /name=error dbCode=23514/);
    assert.equal(line.includes('SENTINEL'), false);
    assert.equal(line.includes(me), false);
  }
});

test('하트·신고 서비스 함수는 console에 아무것도 출력하지 않는다', async () => {
  const originals = {};
  const written = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[method] = console[method];
    console[method] = (...args) => written.push(args.join(' '));
  }
  try {
    const me = newUser();
    handler = (sql) => (/^\s*SELECT c\.user_id/.test(sql) ? { rows: [state()] } : { rows: [{ id: '1' }] });
    await commentsService.likeComment(fakePool, { userId: me, id: '10' });
    await commentsService.unlikeComment(fakePool, { userId: me, id: '10' });
    await commentsService.reportComment(fakePool, { userId: me, id: '10', reason: 'other', detail: SECRET_DETAIL });
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }
  assert.deepEqual(written, []);
});
