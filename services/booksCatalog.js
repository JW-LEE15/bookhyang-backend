// services/booksCatalog.js: 모음집(books 테이블) 조회 - 목록, 상세, 관련 책
// - 소개글(description)은 서버에 저장하지도 캐시하지도 않는다. 이 파일의 어떤 쿼리도 description 컬럼을 읽지 않는다.
// - 정렬은 고정된 두 가지 SQL 조각 중에서만 고른다. 요청 값을 SQL 문자열에 끼우지 않는다.
// - published_date는 date 타입이라 SQL에서 ::text로 가져온다. (JS Date로 바뀌면서 하루가 밀리는 일을 막는다)
// 로그에는 오류 이름과 DB 오류 코드만 남긴다.

const RELATED_LIMIT = 10;

// 응답에 쓰는 컬럼 (description, series_number, created_at은 읽지 않는다)
const BOOK_COLUMNS =
  'id, isbn, title, author, translator, cover_image, published_date::text AS published_date, category';

// 정렬: 같은 값이 있어도 id로 순서를 고정해서, 페이지 사이에 중복과 누락이 생기지 않게 한다
const ORDER_BY = Object.freeze({
  title: 'title ASC, id ASC',
  latest: 'published_date DESC NULLS LAST, id DESC',
});

// ---- 순수 함수 (테스트 대상) ----

const getOrderBy = (sort) => {
  if (typeof sort !== 'string' || !Object.hasOwn(ORDER_BY, sort)) {
    throw new Error('지원하지 않는 정렬입니다.');
  }
  return ORDER_BY[sort];
};

// 쿼리 결과 한 행을 응답 모양으로 (지정한 필드만 꺼내서, 쿼리가 바뀌어도 다른 컬럼이 새지 않게 한다)
const toBookResponse = (row) => ({
  id: row.id,
  isbn: row.isbn,
  title: row.title,
  author: row.author,
  translator: row.translator ?? null,
  cover_image: row.cover_image ?? null,
  published_date: row.published_date ?? null,
  category: row.category ?? null,
});

const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  hasNext: page * limit < total,
});

// 앞뒤 공백을 지우고, 비어 있으면 null (관련 책을 작가로 찾을 때 빈 작가는 쓰지 않는다)
const normalizeAuthor = (author) => {
  if (typeof author !== 'string') return null;
  const trimmed = author.trim();
  return trimmed === '' ? null : trimmed;
};

// ---- DB 조회 ----

const getPool = (deps) => (deps && deps.pool) || require('../db'); // 테스트가 DB 연결 모듈(.env 로드)을 불러오지 않도록 필요할 때 읽는다

// 목록 + 총 개수. category가 null이면 전체(분야가 NULL인 책 포함), 값이 있으면 그 분야로 분류된 책만
const listBooks = async ({ category, sort, page, limit }, deps) => {
  const pool = getPool(deps);
  const orderBy = getOrderBy(sort);
  const offset = (page - 1) * limit;

  const [listResult, countResult] = await Promise.all([
    pool.query(
      `SELECT ${BOOK_COLUMNS}
         FROM books
        WHERE ($1::text IS NULL OR category = $1::text)
        ORDER BY ${orderBy}
        LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
         FROM books
        WHERE ($1::text IS NULL OR category = $1::text)`,
      [category]
    ),
  ]);

  const total = countResult.rows[0].total;
  return {
    data: listResult.rows.map(toBookResponse),
    pagination: buildPagination({ page, limit, total }),
  };
};

// 한 권. 없으면 null
const getBookById = async (id, deps) => {
  const pool = getPool(deps);
  const result = await pool.query(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = $1`, [id]);
  return result.rows.length > 0 ? toBookResponse(result.rows[0]) : null;
};

// 관련 책 최대 10권(자기 자신 제외): 같은 분야(분야가 있을 때) 또는 같은 작가. 같은 작가를 먼저, 그다음 최신순.
const listRelatedBooks = async (book, deps) => {
  const pool = getPool(deps);
  const author = normalizeAuthor(book.author);

  const result = await pool.query(
    `SELECT ${BOOK_COLUMNS}
       FROM books
      WHERE id <> $1
        AND (($2::text IS NOT NULL AND category = $2::text)
          OR ($3::text IS NOT NULL AND author = $3::text))
      ORDER BY COALESCE(author = $3::text, false) DESC, published_date DESC NULLS LAST, id DESC
      LIMIT $4`,
    [book.id, book.category ?? null, author, RELATED_LIMIT]
  );
  return result.rows.map(toBookResponse);
};

module.exports = {
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
};
