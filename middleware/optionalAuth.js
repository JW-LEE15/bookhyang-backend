// middleware/optionalAuth.js: 로그인 여부를 확인하되 비로그인도 통과시킨다. (공개 조회에서 "내 것" 표시용)
// 유효한 토큰이면 req.userId에 유저 id(uuid)를, 아니면 null을 넣는다.
// 헤더가 없거나 형식이 틀리거나 토큰이 만료·위조여도 401을 내지 않고 비로그인으로 취급한다.
//   (원래 공개 GET은 토큰을 보지 않았으므로, 오래된 토큰을 가진 앱이 깨지지 않게 한다)
// 토큰과 헤더 값은 로그에 남기지 않고 오류 이름만 남긴다.
const { verifyToken } = require('../config/auth');

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_.]+)$/;

const optionalAuth = (req, res, next) => {
  req.userId = null;

  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(BEARER_PATTERN) : null;
  if (!match) return next();

  try {
    req.userId = verifyToken(match[1]);
  } catch (error) {
    console.warn('선택 인증 토큰 검증 실패(비로그인으로 처리):', error && error.name);
  }
  return next();
};

module.exports = optionalAuth;
