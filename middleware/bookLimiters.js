// middleware/bookLimiters.js: 책 소개글 API의 IP 기준 횟수 제한 (express-rate-limit)
// 소개글 API는 로그인 없이 호출할 수 있고 요청마다 카카오를 부르기 때문에, 반복 호출로 카카오 한도가 닳지 않게 막는다.
// 제한에 걸리면 PR1과 같은 429 { success:false, code:'RATE_LIMITED', message }를 응답한다.
// IP는 로그에 남기지 않는다. 카운터는 서버 메모리에 있다. (Render에서는 TRUST_PROXY_HOPS가 맞아야 실제 사용자 IP로 센다)
const { createLimiter } = require('./rateLimiters');

// IP당 1분에 60회
const BOOK_DESCRIPTION_LIMIT_OPTIONS = {
  windowMs: 60 * 1000,
  limit: 60,
};

const bookDescriptionLimiter = createLimiter(BOOK_DESCRIPTION_LIMIT_OPTIONS);

module.exports = {
  BOOK_DESCRIPTION_LIMIT_OPTIONS,
  bookDescriptionLimiter,
};
