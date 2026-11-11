// test/trustProxy.test.js: TRUST_PROXY_HOPS 해석 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTrustProxyHops, MAX_TRUST_PROXY_HOPS } = require('../config/trustProxy');

test('값이 없거나 비어 있으면 null (trust proxy를 설정하지 않음)', () => {
  assert.equal(parseTrustProxyHops(undefined), null);
  assert.equal(parseTrustProxyHops(null), null);
  assert.equal(parseTrustProxyHops(''), null);
  assert.equal(parseTrustProxyHops('   '), null);
});

test('0은 null (신뢰할 프록시가 없음)', () => {
  assert.equal(parseTrustProxyHops('0'), null);
  assert.equal(parseTrustProxyHops(' 0 '), null);
});

test('1~최댓값의 정수 문자열은 숫자로 돌려준다', () => {
  assert.equal(parseTrustProxyHops('1'), 1);
  assert.equal(parseTrustProxyHops(' 2 '), 2);
  assert.equal(parseTrustProxyHops(String(MAX_TRUST_PROXY_HOPS)), MAX_TRUST_PROXY_HOPS);
});

test('정수가 아니거나 범위를 벗어나면 예외를 던진다', () => {
  for (const bad of ['-1', '1.5', 'abc', '1e1', '0x1', '1 2', 'true', String(MAX_TRUST_PROXY_HOPS + 1)]) {
    assert.throws(() => parseTrustProxyHops(bad), /TRUST_PROXY_HOPS/, `입력: ${bad}`);
  }
});

test('예외 메시지에 입력값을 넣지 않는다', () => {
  assert.throws(() => parseTrustProxyHops('secret-like-value'), (error) => {
    assert.equal(error.message.includes('secret-like-value'), false);
    return true;
  });
});
