// test/nicknameRoutes.test.js: PATCH /api/auth/nickname 연결 확인 (실제 Express 라우터 + 가짜 pool, DB·.env 사용 없음)
// db.js를 로드하지 않고 require 캐시에 가짜 pool을 넣는다. 쿼리 실제 동작 확인은 scripts/test-nickname.ps1
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.JWT_SECRET = 'test-secret-for-nickname-routes-0123456789';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

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
const authRouter = require('../routes/auth');
const { signToken } = require('../config/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { calls = []; handler = () => ({ rows: [] }); });

const patch = async (userId, body, { token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const t = token === undefined ? (userId ? signToken(userId) : null) : token;
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${baseUrl}/nickname`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

const userRow = (nickname) => ({ id: ME, email: 'a@b.co', nickname, created_at: '2026-11-01T00:00:00.000Z' });

test('토큰이 없으면 401이고 DB를 건드리지 않는다', async () => {
  const { status, body } = await patch(null, { nickname: '새닉네임' });
  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.equal(calls.length, 0);
});

test('위조된 토큰은 401', async () => {
  const { status } = await patch(null, { nickname: '새닉네임' }, { token: 'abc.def.ghi' });
  assert.equal(status, 401);
  assert.equal(calls.length, 0);
});

test('잘못된 닉네임은 400이고 DB를 건드리지 않는다', async () => {
  for (const nickname of ['', '가', '가'.repeat(21), '가\n나', 123]) {
    const { status, body } = await patch(OTHER, { nickname });
    assert.equal(status, 400, String(nickname));
    assert.equal(body.success, false);
  }
  assert.equal(calls.length, 0);
});

test('정상 요청: 200, trim된 값과 토큰의 userId로만 UPDATE하고 응답에 password가 없다', async () => {
  handler = () => ({ rows: [userRow('새닉네임')] });
  const { status, body } = await patch(ME, { nickname: '  새닉네임  ' });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.user, userRow('새닉네임'));
  assert.equal('password' in body.user, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE users SET nickname/);
  assert.deepEqual(calls[0].params, [ME, '새닉네임']);
});

test('요청 본문의 id·user_id는 무시한다 (토큰의 사용자만 바뀐다)', async () => {
  handler = () => ({ rows: [userRow('새닉네임')] });
  await patch(ME, { nickname: '새닉네임', id: OTHER, user_id: OTHER });
  assert.equal(calls[0].params[0], ME);
});

test('닉네임 중복은 허용한다: 같은 닉네임이 이미 있는지 조회하지 않는다', async () => {
  handler = () => ({ rows: [userRow('겹치는닉')] });
  const { status } = await patch(ME, { nickname: '겹치는닉' });
  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /SELECT/i);
});

test('계정이 없으면(0행) 404', async () => {
  handler = () => ({ rows: [] });
  const { status, body } = await patch(ME, { nickname: '새닉네임' });
  assert.equal(status, 404);
  assert.equal(body.success, false);
});

test('DB 오류는 500이고 닉네임을 응답이나 로그에 남기지 않는다', async () => {
  handler = () => new Error('db down');
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
  try {
    const { status, body } = await patch(ME, { nickname: '비밀닉네임SENTINEL' });
    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.equal(JSON.stringify(body).includes('SENTINEL'), false);
  } finally {
    console.error = original;
  }
  assert.equal(logged.join('\n').includes('SENTINEL'), false);
});

test('사용자별 횟수 제한: 11번째 요청은 429, 다른 사용자는 영향이 없다', async () => {
  const LIMITED = '33333333-3333-3333-3333-333333333333';
  handler = () => ({ rows: [userRow('새닉네임')] });
  for (let i = 0; i < 10; i += 1) {
    const { status } = await patch(LIMITED, { nickname: '새닉네임' });
    assert.equal(status, 200, `${i + 1}번째`);
  }
  const limited = await patch(LIMITED, { nickname: '새닉네임' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  const other = await patch('44444444-4444-4444-4444-444444444444', { nickname: '새닉네임' });
  assert.equal(other.status, 200);
});
