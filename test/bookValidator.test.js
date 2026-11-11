// test/bookValidator.test.js: 모음집 쿼리와 id 검증 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, SORTS, MAX_LIMIT, MAX_PAGE, parseBookId, validateListQuery } = require('../validators/bookValidator');

test('쿼리가 없으면 기본값: 전체, title, 1페이지, 30개', () => {
  const expected = { ok: true, value: { category: null, sort: 'title', page: 1, limit: 30 } };
  assert.deepEqual(validateListQuery({}), expected);
  assert.deepEqual(validateListQuery(undefined), expected);
});

test('허용 목록', () => {
  assert.deepEqual(CATEGORIES, ['소설', '시', '에세이']);
  assert.deepEqual(SORTS, ['title', 'latest']);
  assert.equal(MAX_LIMIT, 50);
});

test('category: 소설, 시, 에세이만 허용하고 그 외는 실패', () => {
  for (const category of CATEGORIES) {
    assert.equal(validateListQuery({ category }).value.category, category);
  }
  for (const bad of ['판타지', '', '소설 ', 'ALL', '전체']) {
    assert.equal(validateListQuery({ category: bad }).ok, false, `입력: "${bad}"`);
  }
  assert.equal(validateListQuery({ category: ['소설', '시'] }).ok, false); // 같은 키를 두 번 보낸 경우
});

test('sort: title, latest만 허용하고 그 외는 실패', () => {
  assert.equal(validateListQuery({ sort: 'latest' }).value.sort, 'latest');
  assert.equal(validateListQuery({ sort: 'title' }).value.sort, 'title');
  for (const bad of ['popular', '', 'title ASC', 'id; DROP TABLE books', ['title']]) {
    assert.equal(validateListQuery({ sort: bad }).ok, false, `입력: ${JSON.stringify(bad)}`);
  }
});

test('page: 1 이상의 정수만, 상한을 넘으면 실패', () => {
  assert.equal(validateListQuery({ page: '3' }).value.page, 3);
  assert.equal(validateListQuery({ page: String(MAX_PAGE) }).ok, true);
  for (const bad of ['0', '-1', '1.5', 'abc', '', '1e2', String(MAX_PAGE + 1), '99999999999999999999']) {
    assert.equal(validateListQuery({ page: bad }).ok, false, `입력: "${bad}"`);
  }
});

test('limit: 1 이상의 정수만, 50을 넘으면 50으로 줄인다', () => {
  assert.equal(validateListQuery({ limit: '10' }).value.limit, 10);
  assert.equal(validateListQuery({ limit: '50' }).value.limit, 50);
  assert.equal(validateListQuery({ limit: '51' }).value.limit, 50);
  assert.equal(validateListQuery({ limit: '100' }).value.limit, 50);
  assert.equal(validateListQuery({ limit: '99999999999' }).value.limit, 50);
  for (const bad of ['0', '-5', 'abc', '', '2.5']) {
    assert.equal(validateListQuery({ limit: bad }).ok, false, `입력: "${bad}"`);
  }
});

test('모든 값이 함께 들어와도 읽는다', () => {
  assert.deepEqual(validateListQuery({ category: '시', sort: 'latest', page: '2', limit: '20' }), {
    ok: true,
    value: { category: '시', sort: 'latest', page: 2, limit: 20 },
  });
});

test('실패하면 한국어 메시지가 있다', () => {
  const result = validateListQuery({ category: '판타지' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
});

test('책 id: 양의 정수(integer 범위)만 숫자로, 아니면 null', () => {
  assert.equal(parseBookId('1'), 1);
  assert.equal(parseBookId('1641'), 1641);
  assert.equal(parseBookId('2147483647'), 2147483647);
  for (const bad of ['0', '-1', '01', '1.5', 'abc', '', '2147483648', '9223372036854775807', '1 ', undefined, null, 5, ['1']]) {
    assert.equal(parseBookId(bad), null, `입력: ${JSON.stringify(bad)}`);
  }
});
