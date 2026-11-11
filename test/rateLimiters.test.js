// test/rateLimiters.test.js: 횟수 제한 설정과 429 응답 (순수 함수 테스트, 서버와 DB는 쓰지 않음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
  LOGIN_LIMIT_OPTIONS,
  SIGNUP_LIMIT_OPTIONS,
  rateLimitedHandler,
  loginLimiter,
  signupLimiter,
} = require('../middleware/rateLimiters');

test('로그인 제한: 15분 10회, 성공한 요청은 세지 않는다', () => {
  assert.equal(LOGIN_LIMIT_OPTIONS.windowMs, 15 * 60 * 1000);
  assert.equal(LOGIN_LIMIT_OPTIONS.limit, 10);
  assert.equal(LOGIN_LIMIT_OPTIONS.skipSuccessfulRequests, true);
});

test('회원가입 제한: 1시간 10회, 성공한 요청도 센다', () => {
  assert.equal(SIGNUP_LIMIT_OPTIONS.windowMs, 60 * 60 * 1000);
  assert.equal(SIGNUP_LIMIT_OPTIONS.limit, 10);
  assert.notEqual(SIGNUP_LIMIT_OPTIONS.skipSuccessfulRequests, true);
});

test('제한 미들웨어는 함수다', () => {
  assert.equal(typeof loginLimiter, 'function');
  assert.equal(typeof signupLimiter, 'function');
});

test('429 응답은 정해진 JSON 모양과 한국어 메시지다', () => {
  let statusCode = null;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  rateLimitedHandler({}, res);

  assert.equal(statusCode, 429);
  assert.deepEqual(body, {
    success: false,
    code: 'RATE_LIMITED',
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  });
  assert.equal(RATE_LIMITED_CODE, 'RATE_LIMITED');
  assert.equal(RATE_LIMITED_MESSAGE, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
});

test('429 응답 본문에 요청 정보(IP, 헤더, 본문)를 담지 않는다', () => {
  let body = null;
  const req = {
    ip: '203.0.113.7',
    headers: { authorization: 'Bearer secret-token' },
    body: { email: 'a@example.com', password: 'secret-password' },
  };
  const res = {
    status() {
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  rateLimitedHandler(req, res);

  const text = JSON.stringify(body);
  for (const leaked of ['203.0.113.7', 'secret-token', 'a@example.com', 'secret-password']) {
    assert.equal(text.includes(leaked), false, `응답에 ${leaked}가 포함됨`);
  }
});
