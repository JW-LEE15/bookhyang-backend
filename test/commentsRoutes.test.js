// test/commentsRoutes.test.js: 댓글 라우트 연결 확인 (실제 Express 라우터 + 가짜 pool, DB·.env 사용 없음)
// db.js를 로드하지 않고 require 캐시에 가짜 pool을 넣어서 routes/comments.js가 이를 쓰게 한다.
// 쿼리 문장 자체는 여기서 검증하지 않는다. (실제 DB 확인은 scripts/test-comments-extend.ps1)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const JWT_TEST_SECRET = 'test-secret-for-comment-routes-0123456789';
process.env.JWT_SECRET = JWT_TEST_SECRET;

const ISBN = '9788937460777';
const AUTHOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const SECRET = '비밀-댓글-원문-SENTINEL';

// 테스트마다 handler(sql, params)를 바꿔 끼운다
let handler = () => ({ rows: [] });
const fakePool = {
  query: async (sql, params) => {
    const out = handler(sql, params);
    if (out instanceof Error) throw out;
    return { rowCount: out.rows ? out.rows.length : 0, rows: out.rows || [] };
  },
};
const dbPath = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };
const commentsRouter = require('../routes/comments');
const { signToken } = require('../config/auth');

const row = (overrides = {}) => ({
  id: '10', isbn: ISBN, user_id: AUTHOR, content: SECRET, created_at: '2026-11-12T00:00:00.000Z',
  nickname: '작성자', parent_id: null, is_spoiler: false, is_hidden: false, deleted_at: null, reply_count: '0',
  ...overrides,
});

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

const call = async (method, urlPath, { token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const tokenFor = (userId) => signToken(userId);

// 목록·개수 쿼리에 맞게 응답하는 handler 만들기
const listHandler = (rows, counts = { total: '1', top_level_total: '1' }) => (sql) => (
  /FILTER/.test(sql) ? { rows: [counts] } : { rows }
);

// ---- GET /api/comments ----

test('GET 목록: 토큰 없이 200, 기존 필드와 새 필드가 모두 있다', async () => {
  handler = listHandler([row({ id: '10', reply_count: '2' })], { total: '5', top_level_total: '1' });
  const { status, body } = await call('GET', `?isbn=${ISBN}`);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.total, 5);
  assert.equal(body.top_level_total, 1);
  assert.equal(body.nextCursor, null);
  const item = body.data[0];
  for (const key of ['id', 'isbn', 'user_id', 'content', 'created_at', 'nickname']) assert.ok(key in item, key); // 기존 필드
  for (const key of ['parent_id', 'is_spoiler', 'is_hidden', 'is_deleted', 'content_masked', 'is_mine', 'reply_count']) {
    assert.ok(key in item, key); // 새 필드
  }
  assert.equal(item.reply_count, 2);
  assert.equal(item.is_mine, false);
});

test('GET 목록: 잘못된 토큰이어도 401이 아니라 200 (비로그인 처리)', async () => {
  handler = listHandler([row()]);
  const expired = jwt.sign({}, JWT_TEST_SECRET, { subject: AUTHOR, expiresIn: -10 });
  const { status } = await call('GET', `?isbn=${ISBN}`, { token: expired });
  assert.equal(status, 200);
});

test('GET 목록: 숨김 댓글은 타인·비로그인에게 가려지고 작성자에게는 원문이 보인다', async () => {
  handler = listHandler([row({ is_hidden: true })]);
  for (const token of [undefined, tokenFor(OTHER)]) {
    const { body } = await call('GET', `?isbn=${ISBN}`, { token });
    assert.equal(body.data[0].content_masked, true);
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  }
  const mine = await call('GET', `?isbn=${ISBN}`, { token: tokenFor(AUTHOR) });
  assert.equal(mine.body.data[0].content, SECRET);
  assert.equal(mine.body.data[0].is_hidden, true);
  assert.equal(mine.body.data[0].is_mine, true);
});

test('GET 목록: 잘못된 isbn·limit·before는 400, 기존 메시지', async () => {
  assert.deepEqual(await call('GET', '?isbn=123'), {
    status: 400, body: { success: false, message: 'ISBN13 형식(13자리 숫자)이 올바르지 않습니다.' },
  });
  assert.equal((await call('GET', `?isbn=${ISBN}&limit=0`)).status, 400);
  assert.equal((await call('GET', `?isbn=${ISBN}&before=x`)).status, 400);
});

// ---- GET /api/comments/:id/replies ----

test('GET 답글: 잘못된 id와 없는 원댓글은 404, 잘못된 쿼리는 400', async () => {
  handler = () => ({ rows: [] });
  assert.equal((await call('GET', '/abc/replies')).status, 404);
  const missing = await call('GET', '/5/replies');
  assert.deepEqual(missing, { status: 404, body: { success: false, message: '댓글을 찾을 수 없습니다.' } });
  assert.equal((await call('GET', '/5/replies?limit=0')).status, 400);
});

test('GET 답글: 200과 data·total·nextCursor', async () => {
  handler = (sql) => {
    if (/COUNT\(\*\) AS total/.test(sql)) return { rows: [{ total: '1' }] };
    if (/ORDER BY/.test(sql)) return { rows: [row({ id: '11', parent_id: '10' })] };
    return { rows: [{ ok: 1 }] };
  };
  const { status, body } = await call('GET', '/10/replies');
  assert.equal(status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.nextCursor, null);
  assert.equal(body.data[0].parent_id, '10');
});

// ---- POST /api/comments ----

test('POST: 토큰 없으면 401', async () => {
  const { status } = await call('POST', '', { body: { isbn: ISBN, content: 'a' } });
  assert.equal(status, 401);
});

test('POST: 기존 요청 {isbn, content}는 201, 응답에 기존 필드와 새 필드', async () => {
  handler = () => ({ rows: [row({ id: '1' })] });
  const { status, body } = await call('POST', '', { token: tokenFor(AUTHOR), body: { isbn: ISBN, content: 'a' } });
  assert.equal(status, 201);
  assert.equal(body.message, '댓글이 등록되었습니다.');
  assert.equal(body.data.id, '1');
  assert.equal(body.data.is_mine, true);
  assert.equal(body.data.is_spoiler, false);
});

test('POST: 잘못된 parent_id·is_spoiler는 400', async () => {
  const token = tokenFor(AUTHOR);
  assert.equal((await call('POST', '', { token, body: { isbn: ISBN, content: 'a', parent_id: 'abc' } })).status, 400);
  assert.equal((await call('POST', '', { token, body: { isbn: ISBN, content: 'a', is_spoiler: 'true' } })).status, 400);
});

test('POST 답글 거절: 코드와 상태 코드 (404 / 400 / 400 / 409)', async () => {
  const token = tokenFor(AUTHOR);
  const body = { isbn: ISBN, content: 'a', parent_id: '1' };
  const cases = [
    [[], 404, 'PARENT_NOT_FOUND'],
    [[{ isbn: ISBN, parent_id: '5', is_hidden: false, deleted_at: null }], 400, 'REPLY_TO_REPLY'],
    [[{ isbn: '9788937460999', parent_id: null, is_hidden: false, deleted_at: null }], 400, 'ISBN_MISMATCH'],
    [[{ isbn: ISBN, parent_id: null, is_hidden: true, deleted_at: null }], 409, 'PARENT_HIDDEN'],
  ];
  for (const [parentRows, expectedStatus, expectedCode] of cases) {
    handler = (sql) => (/INSERT/.test(sql) ? { rows: [] } : { rows: parentRows });
    const out = await call('POST', '', { token, body });
    assert.equal(out.status, expectedStatus, expectedCode);
    assert.equal(out.body.success, false);
    assert.equal(out.body.code, expectedCode);
    assert.equal(typeof out.body.message, 'string');
  }
});

// ---- PATCH /api/comments/:id/hidden ----

test('PATCH 숨김: 401 / 잘못된 id 404 / 잘못된 body 400 / 없거나 남의 댓글 404 / 성공 200', async () => {
  assert.equal((await call('PATCH', '/10/hidden', { body: { is_hidden: true } })).status, 401);
  const token = tokenFor(AUTHOR);
  assert.equal((await call('PATCH', '/abc/hidden', { token, body: { is_hidden: true } })).status, 404);
  assert.equal((await call('PATCH', '/10/hidden', { token, body: { is_hidden: 'yes' } })).status, 400);
  assert.equal((await call('PATCH', '/10/hidden', { token })).status, 400);

  handler = () => ({ rows: [] });
  assert.deepEqual(await call('PATCH', '/10/hidden', { token, body: { is_hidden: true } }), {
    status: 404, body: { success: false, message: '댓글을 찾을 수 없습니다.' },
  });

  handler = () => ({ rows: [row({ is_hidden: true })] });
  const ok = await call('PATCH', '/10/hidden', { token, body: { is_hidden: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.is_hidden, true);
  assert.equal(ok.body.data.content, SECRET); // 본인에게는 원문
});

// ---- DELETE /api/comments/:id ----

test('DELETE: 401 / 잘못된 id 404 / 없는·남의 댓글 404 / 삭제 표시와 실제 삭제 모두 같은 200 응답', async () => {
  assert.equal((await call('DELETE', '/10')).status, 401);
  const token = tokenFor(AUTHOR);
  assert.equal((await call('DELETE', '/abc', { token })).status, 404);

  handler = () => ({ rows: [{ marked: '0', removed: '0' }] });
  const missing = await call('DELETE', '/10', { token });
  assert.deepEqual(missing, { status: 404, body: { success: false, message: '댓글을 찾을 수 없습니다.' } });

  handler = () => ({ rows: [{ marked: '1', removed: '0' }] });
  const marked = await call('DELETE', '/10', { token });
  handler = () => ({ rows: [{ marked: '0', removed: '1' }] });
  const removed = await call('DELETE', '/10', { token });
  assert.deepEqual(marked, { status: 200, body: { success: true, message: '댓글이 삭제되었습니다.' } });
  assert.deepEqual(removed, marked);
});

// ---- 오류 로그 ----

test('DB 오류가 나면 500이고, 로그에는 이름과 DB 오류 코드만 남는다 (댓글 원문 없음)', async () => {
  handler = () => Object.assign(new Error(`Failing row contains (${SECRET})`), {
    name: 'error', code: '23514', detail: `Failing row contains (${SECRET})`,
  });
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  try {
    const token = tokenFor(AUTHOR);
    const list = await call('GET', `?isbn=${ISBN}`);
    const create = await call('POST', '', { token, body: { isbn: ISBN, content: SECRET } });
    const hide = await call('PATCH', '/10/hidden', { token, body: { is_hidden: true } });
    const del = await call('DELETE', '/10', { token });
    for (const out of [list, create, hide, del]) {
      assert.equal(out.status, 500);
      assert.equal(out.body.success, false);
      assert.equal(JSON.stringify(out.body).includes(SECRET), false);
    }
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 4);
  for (const line of logged) {
    assert.match(line, /name=error dbCode=23514/);
    assert.equal(line.includes(SECRET), false);
  }
});
