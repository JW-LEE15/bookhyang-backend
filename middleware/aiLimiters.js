// middleware/aiLimiters.js: AI API 사용자별 횟수 제한 (로그인한 사용자 id 기준, express-rate-limit)
// requireAuth 뒤에 붙여서 쓴다. 제한에 걸리면 PR1과 같은 429 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// 사용자 id, IP, 요청 내용은 로그에 남기지 않는다. 카운터는 서버 메모리에 있다.
const { createLimiter } = require('./rateLimiters');

// requireAuth가 req.userId를 넣어 준 뒤에 호출된다
const userKeyGenerator = (req) => String(req.userId);

// 사용자당 1분에 5회
const AI_MINUTE_LIMIT_OPTIONS = {
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: userKeyGenerator,
};

// 사용자당 24시간에 50회 (첫 요청 시각부터 24시간)
const AI_DAY_LIMIT_OPTIONS = {
  windowMs: 24 * 60 * 60 * 1000,
  limit: 50,
  keyGenerator: userKeyGenerator,
};

const aiMinuteLimiter = createLimiter(AI_MINUTE_LIMIT_OPTIONS);
const aiDayLimiter = createLimiter(AI_DAY_LIMIT_OPTIONS);

module.exports = {
  userKeyGenerator,
  AI_MINUTE_LIMIT_OPTIONS,
  AI_DAY_LIMIT_OPTIONS,
  aiMinuteLimiter,
  aiDayLimiter,
};
