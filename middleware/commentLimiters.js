// middleware/commentLimiters.js: 댓글 하트·신고 사용자별 횟수 제한 (로그인한 사용자 id 기준)
// requireAuth 뒤에 붙여서 쓴다. 제한에 걸리면 429 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// 사용자 id, IP, 요청 내용(신고 상세 포함)은 로그에 남기지 않는다. 카운터는 서버 메모리에 있다.
const { createLimiter } = require('./rateLimiters');
const { userKeyGenerator } = require('./aiLimiters');

// 하트(PUT·DELETE가 같은 카운터를 쓴다): 사용자당 1분에 30회
const LIKE_LIMIT_OPTIONS = {
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: userKeyGenerator,
};

// 신고: 사용자당 1시간에 10회
const REPORT_LIMIT_OPTIONS = {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: userKeyGenerator,
};

const commentLikeLimiter = createLimiter(LIKE_LIMIT_OPTIONS);
const commentReportLimiter = createLimiter(REPORT_LIMIT_OPTIONS);

module.exports = {
  LIKE_LIMIT_OPTIONS,
  REPORT_LIMIT_OPTIONS,
  commentLikeLimiter,
  commentReportLimiter,
};
