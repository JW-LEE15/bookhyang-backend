// test/commentValidator.test.js: 댓글 입력 검증 (순수 함수, DB 접속 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCreateComment,
  validateListQuery,
  validateRepliesQuery,
  validateHiddenBody,
  isValidIsbn13,
} = require('../validators/commentValidator');

const ISBN = '9788937460777';

test('기존 요청({isbn, content})은 그대로 통과하고 새 값은 기본값이다', () => {
  const out = validateCreateComment({ isbn: ISBN, content: '  좋았어요  ' });
  assert.deepEqual(out, {
    ok: true,
    value: { isbn: ISBN, content: '좋았어요', parentId: null, isSpoiler: false },
  });
});

test('기존 오류 메시지가 유지된다', () => {
  assert.equal(validateCreateComment({ isbn: '123', content: 'a' }).message, 'ISBN13 형식(13자리 숫자)이 올바르지 않습니다.');
  assert.equal(validateCreateComment({ isbn: ISBN, content: '   ' }).message, '댓글 내용을 입력해 주세요.');
  assert.equal(validateCreateComment({ isbn: ISBN }).message, '댓글 내용을 입력해 주세요.');
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a'.repeat(501) }).message, '댓글은 500자 이하로 입력해 주세요.');
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a'.repeat(500) }).ok, true);
  assert.equal(validateCreateComment(undefined).ok, false);
});

test('parent_id: 없음·null은 원댓글, 문자열과 안전한 정수는 문자열로 정리한다', () => {
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', parent_id: null }).value.parentId, null);
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', parent_id: '12' }).value.parentId, '12');
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', parent_id: 12 }).value.parentId, '12');
  assert.equal(
    validateCreateComment({ isbn: ISBN, content: 'a', parent_id: '9223372036854775807' }).value.parentId,
    '9223372036854775807'
  );
});

test('parent_id: 잘못된 값은 400용 실패', () => {
  const bad = ['0', '-1', '01', '1.5', '', 'abc', '9223372036854775808', 0, -1, 1.5, 2 ** 60, true, {}, [], ['1']];
  for (const parent_id of bad) {
    const out = validateCreateComment({ isbn: ISBN, content: 'a', parent_id });
    assert.equal(out.ok, false, `parent_id=${JSON.stringify(parent_id)}`);
    assert.equal(out.message, 'parent_id 값이 올바르지 않습니다.');
  }
});

test('is_spoiler: boolean만 허용하고 문자열·숫자는 거부한다', () => {
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', is_spoiler: true }).value.isSpoiler, true);
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', is_spoiler: false }).value.isSpoiler, false);
  assert.equal(validateCreateComment({ isbn: ISBN, content: 'a', is_spoiler: null }).value.isSpoiler, false);
  for (const is_spoiler of ['true', 'false', 1, 0, {}, []]) {
    const out = validateCreateComment({ isbn: ISBN, content: 'a', is_spoiler });
    assert.equal(out.ok, false, `is_spoiler=${JSON.stringify(is_spoiler)}`);
    assert.equal(out.message, '스포일러 여부는 true 또는 false여야 합니다.');
  }
});

test('body의 user_id 같은 다른 필드는 결과에 들어가지 않는다', () => {
  const out = validateCreateComment({ isbn: ISBN, content: 'a', user_id: 'x', is_hidden: true });
  assert.deepEqual(Object.keys(out.value).sort(), ['content', 'isSpoiler', 'isbn', 'parentId']);
});

test('목록 쿼리: 기존 동작과 메시지가 유지된다', () => {
  assert.deepEqual(validateListQuery({ isbn: ISBN }), { ok: true, value: { isbn: ISBN, limit: 20, before: null } });
  assert.deepEqual(validateListQuery({ isbn: ISBN, limit: '100', before: '5' }).value, { isbn: ISBN, limit: 50, before: '5' });
  assert.equal(validateListQuery({ isbn: ISBN, limit: '0' }).message, 'limit은 1 이상의 정수여야 합니다.');
  assert.equal(validateListQuery({ isbn: ISBN, before: 'x' }).message, 'before 값이 올바르지 않습니다.');
  assert.equal(validateListQuery({ isbn: 'x' }).message, 'ISBN13 형식(13자리 숫자)이 올바르지 않습니다.');
  assert.equal(validateListQuery(undefined).ok, false);
});

test('답글 목록 쿼리: limit 기본 20·최대 50, after 커서', () => {
  assert.deepEqual(validateRepliesQuery({}), { ok: true, value: { limit: 20, after: null } });
  assert.deepEqual(validateRepliesQuery({ limit: '99', after: '7' }).value, { limit: 50, after: '7' });
  assert.equal(validateRepliesQuery({ limit: '-1' }).message, 'limit은 1 이상의 정수여야 합니다.');
  assert.equal(validateRepliesQuery({ after: '0' }).message, 'after 값이 올바르지 않습니다.');
  assert.equal(validateRepliesQuery(undefined).ok, true);
});

test('숨김 body: is_hidden은 boolean 필수', () => {
  assert.deepEqual(validateHiddenBody({ is_hidden: true }), { ok: true, value: { isHidden: true } });
  assert.deepEqual(validateHiddenBody({ is_hidden: false }), { ok: true, value: { isHidden: false } });
  for (const body of [undefined, {}, { is_hidden: 'true' }, { is_hidden: 1 }, { is_hidden: null }]) {
    assert.equal(validateHiddenBody(body).ok, false, JSON.stringify(body));
  }
});

test('isValidIsbn13은 export되어 있다', () => {
  assert.equal(isValidIsbn13(ISBN), true);
  assert.equal(isValidIsbn13('9788937460'), false);
});
