// validators/bookValidator.js: 모음집(도서 목록·상세) 요청 검증 (외부 의존성 없음)

const CATEGORIES = ['소설', '시', '에세이'];
const SORTS = ['title', 'latest'];

const DEFAULT_SORT = 'title';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_PAGE = 100000;
const PG_INTEGER_MAX = 2147483647; // books.id는 integer

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

const fail = (message) => ({ ok: false, message });

// 양의 정수 문자열이면 숫자로, 아니면 null
const parsePositiveInt = (raw) => {
  if (typeof raw !== 'string' || !POSITIVE_INTEGER_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
};

// URL의 책 id: 1 ~ integer 최댓값의 양의 정수면 숫자로, 아니면 null (호출한 쪽에서 404 처리)
const parseBookId = (raw) => {
  const id = parsePositiveInt(raw);
  return id !== null && id <= PG_INTEGER_MAX ? id : null;
};

// 목록 쿼리 검증. 통과하면 { ok: true, value: { category, sort, page, limit } } (category는 전체면 null)
//  - category: 생략하면 전체, 소설·시·에세이만 허용 (빈 문자열과 배열도 400)
//  - sort: title(기본) | latest
//  - page: 기본 1, 1 ~ MAX_PAGE
//  - limit: 기본 30, 1 이상의 정수이고 MAX_LIMIT을 넘으면 MAX_LIMIT으로 줄인다
const validateListQuery = (query) => {
  const { category, sort, page, limit } = query || {};

  let parsedCategory = null;
  if (category !== undefined) {
    if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
      return fail('category는 소설, 시, 에세이 중 하나여야 합니다.');
    }
    parsedCategory = category;
  }

  let parsedSort = DEFAULT_SORT;
  if (sort !== undefined) {
    if (typeof sort !== 'string' || !SORTS.includes(sort)) {
      return fail('sort는 title 또는 latest여야 합니다.');
    }
    parsedSort = sort;
  }

  let parsedPage = DEFAULT_PAGE;
  if (page !== undefined) {
    parsedPage = parsePositiveInt(page);
    if (parsedPage === null || parsedPage > MAX_PAGE) {
      return fail(`page는 1 이상 ${MAX_PAGE} 이하의 정수여야 합니다.`);
    }
  }

  let parsedLimit = DEFAULT_LIMIT;
  if (limit !== undefined) {
    const requested = parsePositiveInt(limit);
    if (requested === null) {
      return fail('limit은 1 이상의 정수여야 합니다.');
    }
    parsedLimit = Math.min(requested, MAX_LIMIT);
  }

  return {
    ok: true,
    value: { category: parsedCategory, sort: parsedSort, page: parsedPage, limit: parsedLimit },
  };
};

module.exports = {
  CATEGORIES,
  SORTS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  parseBookId,
  validateListQuery,
};
