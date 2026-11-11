// services/safeError.js: 오류를 로그에 남길 때 쓰는 안전한 설명 문자열
// error 객체 전체나 message를 찍으면 DB 오류의 detail에 입력값(댓글 원문 등)이 섞일 수 있다.
// 그래서 오류 이름과 DB 오류 코드(SQLSTATE 등)만 남긴다. 형식이 짧은 영숫자가 아니면 'unknown'으로 바꾼다.
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

const safeToken = (value) => (typeof value === 'string' && SAFE_TOKEN_PATTERN.test(value) ? value : 'unknown');

// 예: describeError(error) -> 'name=error dbCode=23503'
const describeError = (error) => {
  const name = error && typeof error === 'object' ? error.name : undefined;
  const code = error && typeof error === 'object' ? error.code : undefined;
  return `name=${safeToken(name)} dbCode=${safeToken(code)}`;
};

module.exports = { describeError };
