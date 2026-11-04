// config/auth.js: 로그인 토큰(JWT) 발급과 검증
// 토큰과 JWT_SECRET 값은 로그나 응답에 절대 남기지 않는다.
const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
const TOKEN_EXPIRES_IN = '7d';
const JWT_SECRET_MIN_LENGTH = 32;

// 서버 시작 시 호출. JWT_SECRET이 없거나 짧으면 예외를 던진다. (메시지에 값은 넣지 않는다)
const assertJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET 환경변수가 없거나 ${JWT_SECRET_MIN_LENGTH}자 미만입니다. .env를 확인하세요.`);
  }
};

// 로그인한 유저 id로 토큰 발급 (만료 7일)
const signToken = (userId) => {
  assertJwtSecret();
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: TOKEN_EXPIRES_IN,
    subject: String(userId),
  });
};

// 토큰을 검증하고 유저 id를 돌려준다. 위조, 만료, 형식 오류면 예외를 던진다.
const verifyToken = (token) => {
  assertJwtSecret();
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  if (!payload || typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('토큰에 유저 정보가 없습니다.');
  }
  return payload.sub;
};

module.exports = {
  assertJwtSecret,
  signToken,
  verifyToken,
};
