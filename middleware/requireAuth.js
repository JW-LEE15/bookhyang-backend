// middleware/requireAuth.js: Authorization 헤더의 토큰으로 요청자를 확인한다.
// 통과하면 req.userId에 유저 id(uuid)를 넣는다. 토큰과 헤더 값은 로그에 남기지 않는다.
const { verifyToken } = require('../config/auth');

const UNAUTHORIZED_MESSAGE = '로그인이 필요합니다.';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_.]+)$/;

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(BEARER_PATTERN) : null;

  if (!match) {
    return res.status(401).json({ success: false, message: UNAUTHORIZED_MESSAGE });
  }

  try {
    req.userId = verifyToken(match[1]);
    return next();
  } catch (error) {
    // 만료, 위조 등 모두 같은 응답. 오류 종류만 남기고 토큰은 남기지 않는다.
    console.warn('토큰 검증 실패:', error.name);
    return res.status(401).json({ success: false, message: UNAUTHORIZED_MESSAGE });
  }
};

module.exports = requireAuth;
