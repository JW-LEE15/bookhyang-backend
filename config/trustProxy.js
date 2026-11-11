// config/trustProxy.js: TRUST_PROXY_HOPS 환경변수를 Express의 'trust proxy' 값(프록시 단계 수)으로 바꾼다.
// Render처럼 앞단 프록시가 있으면 req.ip가 프록시 주소가 되어, IP 기준 횟수 제한이 모든 사용자를 한 명으로 센다.
// 그래서 신뢰할 프록시 단계 수를 정확히 지정해야 한다. 값은 배포 환경에서 실측해서 정한다.
// 요청 헤더나 IP 값은 로그에 남기지 않는다.

const MAX_TRUST_PROXY_HOPS = 10;

// 비어 있거나 0이면 null (trust proxy를 설정하지 않음).
// 1~10의 정수 문자열이면 숫자로 돌려준다. 그 밖의 값은 설정 실수이므로 예외를 던진다. (메시지에 입력값은 넣지 않는다)
const parseTrustProxyHops = (value) => {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();
  if (text === '') return null;

  if (!/^\d+$/.test(text)) {
    throw new Error(`TRUST_PROXY_HOPS는 0~${MAX_TRUST_PROXY_HOPS} 사이의 정수여야 합니다.`);
  }

  const hops = Number(text);
  if (hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS는 0~${MAX_TRUST_PROXY_HOPS} 사이의 정수여야 합니다.`);
  }

  return hops === 0 ? null : hops;
};

module.exports = {
  MAX_TRUST_PROXY_HOPS,
  parseTrustProxyHops,
};
