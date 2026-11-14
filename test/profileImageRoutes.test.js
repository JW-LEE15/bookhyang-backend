// test/profileImageRoutes.test.js: 프로필 사진 라우트 확인 (실제 Express 라우터 + 가짜 pool, DB·.env 사용 없음)
// app.js와 같은 순서로 조립한다: 사진 스택(인증 -> 제한 -> 150KB 파서) -> 전역 파서 -> 나머지 라우터.
// 순서가 app.js와 같은지는 마지막 테스트가 app.js 파일을 읽어서 확인한다.
// 실제 쿼리 동작 확인은 scripts/test-profile-image.ps1
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = 'test-secret-for-profile-image-routes-0123456789';

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
const { profileImageStack } = require('../routes/profileImage');
const authRouter = require('../routes/auth');
const usersRouter = require('../routes/users');
const { signToken } = require('../config/auth');

const app = express();
app.use('/api/auth/profile-image', ...profileImageStack);
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
// app.js의 전역 오류 처리기와 같은 모양 (err.stack을 찍는다). 사진 경로 오류는 여기까지 오면 안 된다.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('서버 전역 에러 발생:', err.stack);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { calls = []; handler = () => ({ rows: [] }); });

// 테스트마다 다른 사용자 id (사용자별 횟수 제한이 섞이지 않게)
let userCounter = 0;
const newUser = () => `00000000-0000-4000-8000-${String(++userCounter).padStart(12, '0')}`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const fakeJpeg = (size = 2000) => {
  const buffer = Buffer.alloc(size, 0x33);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buffer, 0);
  Buffer.from([0xff, 0xd9]).copy(buffer, size - 2);
  return buffer;
};
const fakePng = (size = 2000) => {
  const buffer = Buffer.alloc(size, 0x44);
  Buffer.from(PNG_SIGNATURE).copy(buffer, 0);
  Buffer.from(PNG_IEND).copy(buffer, size - PNG_IEND.length);
  return buffer;
};

// 요청 보내기. raw가 있으면 그 문자열을 본문으로, 아니면 body를 JSON으로 보낸다.
const send = async (method, urlPath, { userId, body, raw, contentType = 'application/json' } = {}) => {
  const headers = {};
  if (userId) headers.Authorization = `Bearer ${signToken(userId)}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) payload = JSON.stringify(body);
  if (payload !== undefined) headers['Content-Type'] = contentType;
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) json = JSON.parse(buffer.toString('utf8'));
  return { status: res.status, json, buffer, headers: res.headers };
};
const put = (userId, body, extra = {}) => send('PUT', '/api/auth/profile-image', { userId, body, ...extra });

// fn을 실행하는 동안 콘솔 출력을 모아서 돌려준다
const captureConsole = async (fn) => {
  const lines = [];
  const names = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};
  for (const name of names) {
    originals[name] = console[name];
    console[name] = (...args) => lines.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' '));
  }
  try {
    const result = await fn();
    return { result, logs: lines.join(' ') };
  } finally {
    for (const name of names) console[name] = originals[name];
  }
};

const userRow = (id, updatedAt = null) => ({
  id, email: 'a@b.co', nickname: '닉', created_at: '2026-11-01T00:00:00.000Z', profile_image_updated_at: updatedAt,
});

// ---- PUT /api/auth/profile-image ----

test('PUT: 토큰이 없으면 401이고, 큰 본문이어도 413이 아니라 401 (본문을 읽기 전에 인증)', async () => {
  const raw = JSON.stringify({ image: 'A'.repeat(300 * 1024) });
  const out = await send('PUT', '/api/auth/profile-image', { raw });
  assert.equal(out.status, 401);
  assert.equal(out.json.success, false);
  assert.equal(calls.length, 0);
});

test('PUT: JPEG 저장 -> 200, 바이트와 형식은 요청 본문이 아니라 검증 결과로 DB에 간다', async () => {
  const me = newUser();
  const source = fakeJpeg();
  handler = () => ({ rows: [userRow(me, new Date(1700000000000))] });
  const out = await put(me, { image: source.toString('base64'), mime: 'image/png', user_id: newUser() });
  assert.equal(out.status, 200);
  assert.equal(out.json.success, true);
  assert.deepEqual(out.json.user, {
    id: me, email: 'a@b.co', nickname: '닉', created_at: '2026-11-01T00:00:00.000Z',
    profile_image_url: `/api/users/${me}/profile-image?v=1700000000000`,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE users/);
  assert.equal(calls[0].params[0], me); // 토큰의 사용자만
  assert.ok(Buffer.isBuffer(calls[0].params[1]) && calls[0].params[1].equals(source));
  assert.equal(calls[0].params[2], 'image/jpeg'); // 본문이 image/png라고 해도 바이트로 판정
});

test('PUT: PNG 저장 -> 형식 image/png', async () => {
  const me = newUser();
  handler = () => ({ rows: [userRow(me, new Date(1))] });
  const out = await put(me, { image: fakePng().toString('base64') });
  assert.equal(out.status, 200);
  assert.equal(calls[0].params[2], 'image/png');
});

test('PUT: 100KB 사진(base64 약 137KB)은 전역 파서(100KB)보다 앞의 150KB 파서로 받는다', async () => {
  const me = newUser();
  handler = () => ({ rows: [userRow(me, new Date(1))] });
  const image = fakeJpeg(102400).toString('base64');
  assert.ok(image.length > 100 * 1024); // 전역 기본 한도를 넘는 크기
  const out = await put(me, { image });
  assert.equal(out.status, 200);
  assert.equal(calls[0].params[1].length, 102400);
});

test('PUT: JPEG/PNG가 아니면 400이고 DB를 건드리지 않는다', async () => {
  const me = newUser();
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400, 0x41)]);
  const html = Buffer.concat([Buffer.from('<html>'), Buffer.alloc(400, 0x41)]);
  for (const buffer of [gif, html]) {
    const out = await put(me, { image: buffer.toString('base64') });
    assert.equal(out.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('PUT: 비 base64, image 없음은 400', async () => {
  const me = newUser();
  assert.equal((await put(me, { image: 'not base64 !!!' })).status, 400);
  assert.equal((await put(me, {})).status, 400);
  assert.equal((await put(me, { image: 123 })).status, 400);
  assert.equal(calls.length, 0);
});

test('PUT: JSON이 아닌 Content-Type은 400 (본문을 읽지 않는다)', async () => {
  const me = newUser();
  const out = await put(me, undefined, { raw: 'image=AAAA', contentType: 'text/plain' });
  assert.equal(out.status, 400);
  assert.equal(calls.length, 0);
});

test('PUT: 디코딩하면 100KB를 넘는 사진은 413', async () => {
  const me = newUser();
  const out = await put(me, { image: fakeJpeg(102401).toString('base64') });
  assert.equal(out.status, 413);
  assert.equal(out.json.code, 'IMAGE_TOO_LARGE');
  assert.equal(calls.length, 0);
});

test('PUT: 본문이 150KB를 넘으면 파서가 막아서 500이 아니라 413, 로그와 응답에 본문이 없다', async () => {
  const me = newUser();
  const raw = JSON.stringify({ image: `SENTINEL_BIG_BODY${'A'.repeat(200 * 1024)}` });
  const { result: out, logs } = await captureConsole(() => send('PUT', '/api/auth/profile-image', { userId: me, raw }));
  assert.equal(out.status, 413);
  assert.equal(out.json.code, 'IMAGE_TOO_LARGE');
  assert.equal(logs.includes('SENTINEL_BIG_BODY'), false);
  assert.equal(JSON.stringify(out.json).includes('SENTINEL_BIG_BODY'), false);
  assert.equal(logs.includes('서버 전역 에러'), false); // 전역 오류 처리기를 거치지 않았다
  assert.equal(calls.length, 0);
});

test('PUT: 깨진 JSON은 500이 아니라 400, 로그와 응답에 본문 내용이 없다', async () => {
  const me = newUser();
  // 배열로 시작하는 깨진 JSON은 Node의 SyntaxError 메시지에 본문 앞부분이 들어간다.
  // (예: Unexpected token 'S', "[SENTINEL_B"... is not valid JSON) 전역 오류 처리기가 err.stack을 찍으면 로그에 남는 종류다.
  for (const raw of ['[SENTINEL_BROKEN_JSON_PAYLOAD', '{"image": "SENTINEL_BROKEN_JSON_PAYLOAD']) {
    const { result: out, logs } = await captureConsole(() => send('PUT', '/api/auth/profile-image', { userId: me, raw }));
    assert.equal(out.status, 400, raw);
    assert.equal(out.json.success, false);
    assert.equal(logs.includes('SENTINEL_'), false, raw);
    assert.equal(JSON.stringify(out.json).includes('SENTINEL_'), false, raw);
    assert.equal(logs.includes('서버 전역 에러'), false);
    assert.match(logs, /entity[.]parse[.]failed/); // 로그에는 오류 종류만 남는다
  }
  assert.equal(calls.length, 0);
});

test('PUT: 성공하는 동안 사진 데이터가 로그 어디에도 찍히지 않는다', async () => {
  const me = newUser();
  handler = () => ({ rows: [userRow(me, new Date(1))] });
  const image = fakeJpeg(5000).toString('base64');
  const { result: out, logs } = await captureConsole(() => put(me, { image }));
  assert.equal(out.status, 200);
  assert.equal(logs.includes(image.slice(0, 40)), false);
  assert.equal(logs.includes(image.slice(-40)), false);
});

test('PUT: 거절되는 동안에도 사진 데이터가 로그에 찍히지 않는다 (GIF, 용량 초과)', async () => {
  const me = newUser();
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400, 0x41)]).toString('base64');
  const big = fakeJpeg(102401).toString('base64');
  const { logs } = await captureConsole(async () => {
    await put(me, { image: gif });
    await put(me, { image: big });
  });
  assert.equal(logs.includes(gif.slice(0, 40)), false);
  assert.equal(logs.includes(big.slice(0, 40)), false);
});

test('PUT: 계정이 없으면(0행) 404', async () => {
  const out = await put(newUser(), { image: fakeJpeg().toString('base64') });
  assert.equal(out.status, 404);
});

test('PUT: DB 오류는 500이고, 오류 메시지의 내용(사진·입력값)은 로그와 응답에 없다', async () => {
  const me = newUser();
  const error = new Error('insert failed SENTINEL_DB_DETAIL');
  error.code = '23514';
  error.detail = 'Failing row contains SENTINEL_DB_DETAIL';
  handler = () => error;
  const image = fakeJpeg().toString('base64');
  const { result: out, logs } = await captureConsole(() => put(me, { image }));
  assert.equal(out.status, 500);
  assert.equal(logs.includes('SENTINEL_DB_DETAIL'), false);
  assert.equal(logs.includes(image.slice(0, 40)), false);
  assert.equal(JSON.stringify(out.json).includes('SENTINEL_DB_DETAIL'), false);
  assert.match(logs, /dbCode=23514/);
});

test('PUT·DELETE: 사용자별 횟수 제한은 합쳐서 시간당 20회, 21번째는 429', async () => {
  const limited = newUser();
  handler = () => ({ rows: [userRow(limited)] });
  for (let i = 0; i < 20; i += 1) {
    const out = i % 2 === 0
      ? await send('DELETE', '/api/auth/profile-image', { userId: limited })
      : await put(limited, { image: fakeJpeg().toString('base64') });
    assert.equal(out.status, 200, `${i + 1}번째`);
  }
  const over = await send('DELETE', '/api/auth/profile-image', { userId: limited });
  assert.equal(over.status, 429);
  assert.equal(over.json.code, 'RATE_LIMITED');
  assert.equal((await send('DELETE', '/api/auth/profile-image', { userId: newUser() })).status, 200); // 다른 사용자는 영향 없음
});

// ---- DELETE /api/auth/profile-image ----

test('DELETE: 토큰이 없으면 401', async () => {
  const out = await send('DELETE', '/api/auth/profile-image');
  assert.equal(out.status, 401);
  assert.equal(calls.length, 0);
});

test('DELETE: 200, 토큰의 사용자만 NULL로 만들고, 사진이 이미 없어도 200 (멱등)', async () => {
  const me = newUser();
  handler = () => ({ rows: [userRow(me, null)] });
  for (let i = 0; i < 2; i += 1) {
    const out = await send('DELETE', '/api/auth/profile-image', { userId: me });
    assert.equal(out.status, 200);
    assert.equal(out.json.user.profile_image_url, null);
  }
  assert.match(calls[0].sql, /profile_image = NULL/);
  assert.deepEqual(calls[0].params, [me]);
});

test('DELETE: 계정이 없으면(0행) 404', async () => {
  assert.equal((await send('DELETE', '/api/auth/profile-image', { userId: newUser() })).status, 404);
});

// ---- GET /api/users/:id/profile-image ----

test('GET: 토큰 없이 200, 저장된 형식과 바이트 그대로, 캐시·nosniff 헤더', async () => {
  const owner = newUser();
  const source = fakeJpeg(3000);
  handler = () => ({ rows: [{ profile_image: source, profile_image_type: 'image/jpeg' }] });
  const out = await send('GET', `/api/users/${owner}/profile-image`);
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('content-type'), 'image/jpeg');
  assert.equal(out.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(out.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(out.buffer.equals(source));
  assert.deepEqual(calls[0].params, [owner]);
  assert.match(calls[0].sql, /profile_image IS NOT NULL/);
});

test('GET: PNG는 image/png로 나간다', async () => {
  handler = () => ({ rows: [{ profile_image: fakePng(), profile_image_type: 'image/png' }] });
  const out = await send('GET', `/api/users/${newUser()}/profile-image`);
  assert.equal(out.headers.get('content-type'), 'image/png');
});

test('GET: 사진이 없거나 사용자가 없으면 404', async () => {
  const out = await send('GET', `/api/users/${newUser()}/profile-image`);
  assert.equal(out.status, 404);
  assert.equal(out.json.success, false);
});

test('GET: id가 uuid 형식이 아니면 DB를 부르지 않고 404', async () => {
  for (const id of ['abc', '123', 'not-a-uuid', '00000000-0000-4000-8000-00000000000g', '%27%20OR%201=1']) {
    const out = await send('GET', `/api/users/${id}/profile-image`);
    assert.equal(out.status, 404, id);
  }
  assert.equal(calls.length, 0);
});

test('GET: DB 오류는 500이고 오류 내용은 로그에 없다', async () => {
  const error = new Error('SENTINEL_GET_ERROR');
  error.code = '08006';
  handler = () => error;
  const { result: out, logs } = await captureConsole(() => send('GET', `/api/users/${newUser()}/profile-image`));
  assert.equal(out.status, 500);
  assert.equal(logs.includes('SENTINEL_GET_ERROR'), false);
});

// ---- 로그인 / 닉네임 응답 ----

test('로그인: 컬럼을 명시한 쿼리를 쓰고(SELECT * 아님, 사진 바이트 컬럼 없음), 응답에 password와 사진 바이트가 없고 profile_image_url이 있다', async () => {
  const me = newUser();
  const hash = bcrypt.hashSync('password-for-test-1', 4);
  handler = () => ({
    rows: [{
      id: me, email: 'a@b.co', password: hash, nickname: '닉', created_at: '2026-11-01T00:00:00.000Z',
      profile_image_updated_at: new Date(1700000000000),
      profile_image: Buffer.from('SHOULD_NEVER_APPEAR'), // 혹시 행에 섞여 와도 응답에 나오면 안 된다
    }],
  });
  const out = await send('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'password-for-test-1' } });
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.json.user).sort(), ['created_at', 'email', 'id', 'nickname', 'profile_image_url']);
  assert.equal(out.json.user.profile_image_url, `/api/users/${me}/profile-image?v=1700000000000`);
  assert.equal(JSON.stringify(out.json).includes('SHOULD_NEVER_APPEAR'), false);
  assert.ok(out.json.token);
  const sql = calls[0].sql;
  assert.equal(/SELECT[ ]+[*]/i.test(sql), false);
  assert.ok(sql.includes('profile_image_updated_at'));
  assert.equal(sql.replaceAll('profile_image_updated_at', '').includes('profile_image'), false); // 바이트 컬럼은 읽지 않는다
});

test('로그인: 사진이 없으면 profile_image_url은 null', async () => {
  const hash = bcrypt.hashSync('password-for-test-2', 4);
  handler = () => ({
    rows: [{ id: newUser(), email: 'a@b.co', password: hash, nickname: '닉', created_at: 'x', profile_image_updated_at: null }],
  });
  const out = await send('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'password-for-test-2' } });
  assert.equal(out.status, 200);
  assert.equal(out.json.user.profile_image_url, null);
});

// ---- app.js 연결 순서 ----

test('app.js: 사진 스택이 전역 express.json()보다 앞에 등록되어 있고, users 라우터도 연결되어 있다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const stackIndex = source.indexOf("app.use('/api/auth/profile-image', ...profileImageStack)");
  const jsonIndex = source.indexOf('app.use(express.json())');
  const authIndex = source.indexOf("app.use('/api/auth', authRouter)");
  assert.ok(stackIndex > -1, '사진 스택 등록이 없다');
  assert.ok(jsonIndex > -1);
  assert.ok(stackIndex < jsonIndex, '사진 스택이 전역 파서보다 뒤에 있다');
  assert.ok(stackIndex < authIndex);
  assert.ok(source.includes("app.use('/api/users', usersRouter)"));
});
