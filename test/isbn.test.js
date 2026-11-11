// test/isbn.test.js: ISBN 13자리 정규화 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidIsbn10, isbn10To13, normalizeIsbn13 } = require('../services/isbn');

test('ISBN-10 체크섬', () => {
  assert.equal(isValidIsbn10('8937460440'), true);
  assert.equal(isValidIsbn10('8937460441'), false);
  assert.equal(isValidIsbn10('080442957X'), true); // X로 끝나는 유효한 ISBN-10
  assert.equal(isValidIsbn10('abc'), false);
});

test('ISBN-10을 ISBN-13으로 바꾼다 (데미안)', () => {
  assert.equal(isbn10To13('8937460440'), '9788937460449');
  assert.equal(isbn10To13('080442957X'), '9780804429573');
  assert.equal(isbn10To13('8937460441'), null);
  assert.equal(isbn10To13(undefined), null);
});

test('13자리는 그대로, 하이픈과 공백을 정리한다', () => {
  assert.equal(normalizeIsbn13('9788937460449'), '9788937460449');
  assert.equal(normalizeIsbn13(' 978-89-374-6044-9 '), '9788937460449');
});

test('"ISBN10 ISBN13" 형태에서는 13자리를 고른다 (순서와 상관없이)', () => {
  assert.equal(normalizeIsbn13('8937460440 9788937460449'), '9788937460449');
  assert.equal(normalizeIsbn13('9788937460449 8937460440'), '9788937460449');
});

test('ISBN-10만 있으면 13자리로 변환한다', () => {
  assert.equal(normalizeIsbn13('8937460440'), '9788937460449');
  assert.equal(normalizeIsbn13('89-374-6044-0'), '9788937460449');
});

test('빈 문자열, 쓸 수 없는 값은 null', () => {
  assert.equal(normalizeIsbn13(''), null);
  assert.equal(normalizeIsbn13('   '), null);
  assert.equal(normalizeIsbn13('abc'), null);
  assert.equal(normalizeIsbn13('8937460441'), null); // 체크섬이 틀린 ISBN-10
  assert.equal(normalizeIsbn13(null), null);
  assert.equal(normalizeIsbn13(undefined), null);
  assert.equal(normalizeIsbn13(9788937460449), null);
});
