// middleware/rateLimiters.js: 로그인·회원가입 횟수 제한 (IP 기준, express-rate-limit)
// 제한에 걸리면 429와 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// IP, 요청 본문, 헤더는 로그에 남기지 않는다. (이 파일은 로그를 출력하지 않는다)
// 카운터는 서버 메모리에 있어서 서버를 재시작하면 초기화된다. (서버가 한 대일 때 쓰는 구성)
const rateLimit = require('express-rate-limit');

const RATE_LIMITED_CODE = 'RATE_LIMITED';
const RATE_LIMITED_MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

// 로그인: IP당 15분에 10회. 성공한 요청(상태 코드 400 미만)은 세지 않아서, 실패한 시도만 쌓인다.
const LOGIN_LIMIT_OPTIONS = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
};

// 회원가입: IP당 1시간에 10회. 성공·실패 모두 센다.
const SIGNUP_LIMIT_OPTIONS = {
  windowMs: 60 * 60 * 1000,
  limit: 10,
};

// 제한에 걸렸을 때의 응답
const rateLimitedHandler = (req, res) => {
  res.status(429).json({
    success: false,
    code: RATE_LIMITED_CODE,
    message: RATE_LIMITED_MESSAGE,
  });
};

// 남은 횟수는 RateLimit 표준 헤더로, 429일 때는 Retry-After 헤더로 알려 준다. (X-RateLimit-* 옛 헤더는 끈다)
const createLimiter = (options) =>
  rateLimit({
    ...options,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitedHandler,
  });

const loginLimiter = createLimiter(LOGIN_LIMIT_OPTIONS);
const signupLimiter = createLimiter(SIGNUP_LIMIT_OPTIONS);

module.exports = {
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
  LOGIN_LIMIT_OPTIONS,
  SIGNUP_LIMIT_OPTIONS,
  rateLimitedHandler,
  createLimiter,
  loginLimiter,
  signupLimiter,
};
