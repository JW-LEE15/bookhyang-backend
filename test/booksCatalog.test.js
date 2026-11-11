// test/booksCatalog.test.js: 모음집 서비스의 순수 부분과 소개글 추출 (DB·네트워크 없음)
// 쿼리 함수는 가짜 pool로 "어떤 SQL과 파라미터를 보내는지"만 확인한다. 실제 정렬·페이지 결과는 DB에서 로컬로 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RELATED_LIMIT,
  BOOK_COLUMNS,
  ORDER_BY,
  getOrderBy,
  toBookResponse,
  buildPagination,
  normalizeAuthor,
  listBooks,
  getBookById,
  listRelatedBooks,
} = require('../services/booksCatalog');
const { extractDescription, fetchDescription } = require('../services/kakaoDescription');
const { BOOK_DESCRIPTION_LIMIT_OPTIONS, bookDescriptionLimiter } = require('../middleware/bookLimiters');

test('정렬은 고정된 두 가지 SQL 조각뿐이다 (id로 순서를 고정)', () => {
  assert.equal(getOrderBy('title'), 'title ASC, id ASC');
  assert.equal(getOrderBy('latest'), 'published_date DESC NULLS LAST, id DESC');
  assert.deepEqual(Object.keys(ORDER_BY).sort(), ['latest', 'title']);
});

test('정렬 이름이 목록에 없으면 예외 (요청 값이 SQL에 끼어들 수 없다)', () => {
  for (const bad of ['popular', 'title; DROP TABLE books', '', undefined, null, 'toString', '__proto__', 'constructor']) {
    assert.throws(() => getOrderBy(bad), /정렬/, `입력: ${bad}`);
  }
});

test('페이지 정보: hasNext는 page * limit < total', () => {
  assert.deepEqual(buildPagination({ page: 1, limit: 30, total: 1641 }), { page: 1, limit: 30, total: 1641, hasNext: true });
  assert.equal(buildPagination({ page: 54, limit: 30, total: 1641 }).hasNext, true); // 1620 < 1641
  assert.equal(buildPagination({ page: 55, limit: 30, total: 1641 }).hasNext, false); // 마지막 페이지(21권)
  assert.equal(buildPagination({ page: 1, limit: 30, total: 30 }).hasNext, false); // 딱 맞는 경우
  assert.equal(buildPagination({ page: 1, limit: 30, total: 31 }).hasNext, true);
  assert.equal(buildPagination({ page: 1, limit: 30, total: 0 }).hasNext, false);
  assert.equal(buildPagination({ page: 9, limit: 30, total: 10 }).hasNext, false); // 범위를 벗어난 페이지
});

test('응답 모양: 정해진 필드만 나가고 소개글 등 다른 컬럼은 새지 않는다', () => {
  const response = toBookResponse({
    id: 7,
    isbn: '9788937460449',
    title: '데미안',
    author: '헤르만 헤세',
    translator: '전영애',
    cover_image: 'https://example.com/c.jpg',
    published_date: '2000-12-01',
    category: '소설',
    description: '저장하면 안 되는 소개글',
    series_number: 3,
    created_at: '2026-11-05T00:00:00Z',
  });
  assert.deepEqual(response, {
    id: 7,
    isbn: '9788937460449',
    title: '데미안',
    author: '헤르만 헤세',
    translator: '전영애',
    cover_image: 'https://example.com/c.jpg',
    published_date: '2000-12-01',
    category: '소설',
  });
});

test('응답 모양: 없는 값은 null', () => {
  const response = toBookResponse({ id: 1, isbn: '9788937460449', title: 't', author: 'a' });
  assert.equal(response.translator, null);
  assert.equal(response.cover_image, null);
  assert.equal(response.published_date, null);
  assert.equal(response.category, null);
});

test('SELECT 컬럼에 description이 없고 날짜는 ::text로 가져온다', () => {
  assert.equal(/description/.test(BOOK_COLUMNS), false);
  assert.match(BOOK_COLUMNS, /published_date::text AS published_date/);
});

test('작가 정리: 공백은 지우고 비면 null', () => {
  assert.equal(normalizeAuthor('  헤르만 헤세 '), '헤르만 헤세');
  assert.equal(normalizeAuthor('   '), null);
  assert.equal(normalizeAuthor(''), null);
  assert.equal(normalizeAuthor(null), null);
  assert.equal(normalizeAuthor(undefined), null);
});

// 가짜 pool: 보낸 SQL과 파라미터를 기록하고 정해 둔 행을 돌려준다
const makePool = (responder) => {
  const calls = [];
  return {
    calls,
    pool: {
      query: async (sql, params) => {
        calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return responder(sql, params);
      },
    },
  };
};

test('목록 쿼리: 파라미터 [category, limit, offset]과 고정 정렬, 요청 값은 SQL에 끼지 않는다', async () => {
  const { pool, calls } = makePool((sql) =>
    /COUNT/.test(sql) ? { rows: [{ total: 100 }] } : { rows: [{ id: 1, isbn: '9788937460449', title: 't', author: 'a' }] }
  );
  const result = await listBooks({ category: '소설', sort: 'latest', page: 3, limit: 20 }, { pool });

  const list = calls.find((c) => /ORDER BY/.test(c.sql));
  assert.deepEqual(list.params, ['소설', 20, 40]); // offset = (3 - 1) * 20
  assert.match(list.sql, /ORDER BY published_date DESC NULLS LAST, id DESC LIMIT \$2 OFFSET \$3/);
  assert.equal(list.sql.includes('소설'), false);
  assert.equal(list.sql.includes('description'), false);
  const count = calls.find((c) => /COUNT/.test(c.sql));
  assert.deepEqual(count.params, ['소설']);

  assert.deepEqual(result.pagination, { page: 3, limit: 20, total: 100, hasNext: true });
  assert.equal(result.data.length, 1);
});

test('목록 쿼리: 전체(category null)는 NULL 분야까지 포함하는 조건', async () => {
  const { pool, calls } = makePool((sql) => (/COUNT/.test(sql) ? { rows: [{ total: 0 }] } : { rows: [] }));
  const result = await listBooks({ category: null, sort: 'title', page: 1, limit: 30 }, { pool });
  assert.deepEqual(calls.find((c) => /ORDER BY/.test(c.sql)).params, [null, 30, 0]);
  assert.match(calls[0].sql, /\$1::text IS NULL OR category = \$1::text/);
  assert.deepEqual(result, { data: [], pagination: { page: 1, limit: 30, total: 0, hasNext: false } });
});

test('상세 쿼리: 없으면 null', async () => {
  const empty = makePool(() => ({ rows: [] }));
  assert.equal(await getBookById(5, { pool: empty.pool }), null);
  assert.deepEqual(empty.calls[0].params, [5]);
  const found = makePool(() => ({ rows: [{ id: 5, isbn: '9788937460449', title: 't', author: 'a', description: 'x' }] }));
  const book = await getBookById(5, { pool: found.pool });
  assert.equal(book.id, 5);
  assert.equal('description' in book, false);
});

test('관련 책 쿼리: 자기 자신 제외, 분야와 작가 파라미터, 최대 10권', async () => {
  const { pool, calls } = makePool(() => ({ rows: [] }));
  await listRelatedBooks({ id: 9, author: ' 헤르만 헤세 ', category: '소설' }, { pool });
  assert.deepEqual(calls[0].params, [9, '소설', '헤르만 헤세', RELATED_LIMIT]);
  assert.equal(RELATED_LIMIT, 10);
  assert.match(calls[0].sql, /WHERE id <> \$1/);
  assert.match(calls[0].sql, /LIMIT \$4/);
});

test('관련 책 쿼리: 분야가 NULL이고 작가가 비면 두 조건 모두 NULL로 보낸다', async () => {
  const { pool, calls } = makePool(() => ({ rows: [] }));
  await listRelatedBooks({ id: 9, author: '  ', category: null }, { pool });
  assert.deepEqual(calls[0].params, [9, null, null, 10]);
});

// ---- 카카오 소개글 ----

const DOCS = [
  { isbn: '8937460001 9788937460001', contents: '다른 책의 소개글' },
  { isbn: '8937460440 9788937460449', contents: '  데미안 소개글입니다.  ' },
];

test('소개글 추출: ISBN이 일치하는 책의 contents만 쓰고 앞뒤 공백을 지운다', () => {
  assert.equal(extractDescription(DOCS, '9788937460449'), '데미안 소개글입니다.');
  assert.equal(extractDescription(DOCS, '9788937460001'), '다른 책의 소개글');
});

test('소개글 추출: 일치하는 책이 없거나 소개글이 비면 null', () => {
  assert.equal(extractDescription(DOCS, '9780000000002'), null);
  assert.equal(extractDescription([{ isbn: '9788937460449', contents: '   ' }], '9788937460449'), null);
  assert.equal(extractDescription([{ isbn: '9788937460449' }], '9788937460449'), null);
  assert.equal(extractDescription([{ isbn: '9788937460449', contents: 123 }], '9788937460449'), null);
  assert.equal(extractDescription([], '9788937460449'), null);
  assert.equal(extractDescription(null, '9788937460449'), null);
  assert.equal(extractDescription(DOCS, null), null);
});

test('소개글 가져오기: ISBN을 쓸 수 없으면 카카오를 호출하지 않고 null', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, json: async () => ({ documents: [] }) };
  };
  assert.equal(await fetchDescription('', { fetchImpl }), null);
  assert.equal(await fetchDescription(null, { fetchImpl }), null);
  assert.equal(called, false);
});

test('IP 제한: 소개글 API는 1분에 60회', () => {
  assert.equal(BOOK_DESCRIPTION_LIMIT_OPTIONS.windowMs, 60 * 1000);
  assert.equal(BOOK_DESCRIPTION_LIMIT_OPTIONS.limit, 60);
  assert.equal(typeof bookDescriptionLimiter, 'function');
});
