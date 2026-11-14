// middleware/nicknameLimiter.js: 닉네임 수정 사용자별 횟수 제한 (로그인한 사용자 id 기준)
// requireAuth 뒤에 붙여서 쓴다. 제한에 걸리면 429 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// 사용자 id, IP, 요청 내용은 로그에 남기지 않는다. 카운터는 서버 메모리에 있다.
const { createLimiter } = require('./rateLimiters');
const { userKeyGenerator } = require('./aiLimiters');

// 사용자당 1시간에 10회
const NICKNAME_LIMIT_OPTIONS = {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: userKeyGenerator,
};

const nicknameLimiter = createLimiter(NICKNAME_LIMIT_OPTIONS);

module.exports = {
  NICKNAME_LIMIT_OPTIONS,
  nicknameLimiter,
};
