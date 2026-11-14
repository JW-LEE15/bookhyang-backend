// middleware/profileImageLimiter.js: 프로필 사진 올리기·지우기 사용자별 횟수 제한 (로그인한 사용자 id 기준)
// requireAuth 뒤에 붙여서 쓴다. 제한에 걸리면 429 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// 사용자 id, IP, 요청 내용은 로그에 남기지 않는다. 카운터는 서버 메모리에 있다.
const { createLimiter } = require('./rateLimiters');
const { userKeyGenerator } = require('./aiLimiters');

// 사용자당 1시간에 20회 (올리기와 지우기를 합쳐서 센다)
const PROFILE_IMAGE_LIMIT_OPTIONS = {
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: userKeyGenerator,
};

const profileImageLimiter = createLimiter(PROFILE_IMAGE_LIMIT_OPTIONS);

module.exports = {
  PROFILE_IMAGE_LIMIT_OPTIONS,
  profileImageLimiter,
};
