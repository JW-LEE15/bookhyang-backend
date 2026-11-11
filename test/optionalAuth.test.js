// test/optionalAuth.test.js: 선택 인증 미들웨어 (가짜 req/res, 서버·DB 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const SECRET = 'test-secret-for-optional-auth-0123456789';
const USER_ID = '33333333-3333-3333-3333-333333333333';

// config/auth는 호출 시점에 process.env.JWT_SECRET을 읽으므로 테스트 동안만 설정한다
const withSecret = async (fn) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn(warnings);
  } finally {
    console.warn = originalWarn;
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
};

const optionalAuth = require('../middleware/optionalAuth');
const { signToken } = require('../config/auth');

// 미들웨어를 실행하고 { req, nextCalled, responded }를 돌려준다
const run = (authorization) => {
  const req = { headers: authorization === undefined ? {} : { authorization } };
  let nextCalled = false;
  let responded = false;
  const res = { status: () => { responded = true; return res; }, json: () => { responded = true; return res; } };
  optionalAuth(req, res, () => { nextCalled = true; });
  return { req, nextCalled, responded };
};

test('헤더가 없으면 비로그인(null)으로 통과한다', async () => {
  await withSecret(() => {
    const out = run(undefined);
    assert.equal(out.req.userId, null);
    assert.equal(out.nextCalled, true);
    assert.equal(out.responded, false);
  });
});

test('유효한 토큰이면 req.userId에 유저 id가 들어간다', async () => {
  await withSecret(() => {
    const out = run(`Bearer ${signToken(USER_ID)}`);
    assert.equal(out.req.userId, USER_ID);
    assert.equal(out.nextCalled, true);
  });
});

test('형식이 틀린 헤더는 401 없이 비로그인으로 통과한다', async () => {
  await withSecret(() => {
    for (const header of ['Basic abc', 'Bearer', 'Bearer a b', 'bearer abc', '']) {
      const out = run(header);
      assert.equal(out.req.userId, null, header);
      assert.equal(out.nextCalled, true, header);
      assert.equal(out.responded, false, header);
    }
  });
});

test('위조·만료 토큰은 401 없이 비로그인으로 통과하고, 로그에는 오류 이름만 남는다', async () => {
  await withSecret((warnings) => {
    const forged = jwt.sign({}, 'another-secret-another-secret-012345678', { subject: USER_ID });
    const expired = jwt.sign({}, SECRET, { subject: USER_ID, expiresIn: -10 });
    for (const token of [forged, expired, 'abc.def.ghi']) {
      const out = run(`Bearer ${token}`);
      assert.equal(out.req.userId, null);
      assert.equal(out.nextCalled, true);
      assert.equal(out.responded, false);
    }
    assert.equal(warnings.length, 3);
    for (const line of warnings) {
      assert.equal(line.includes(USER_ID), false);
      assert.equal(line.includes('eyJ'), false); // 토큰 본문이 로그에 없다
    }
  });
});

test('JWT_SECRET이 없어도 공개 조회는 막히지 않는다 (비로그인 처리)', async () => {
  const previous = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const out = run('Bearer abc.def.ghi');
    assert.equal(out.req.userId, null);
    assert.equal(out.nextCalled, true);
  } finally {
    console.warn = originalWarn;
    if (previous !== undefined) process.env.JWT_SECRET = previous;
  }
});
