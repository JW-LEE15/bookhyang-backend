// validators/commentValidator.js: 댓글 입력값 검증 (외부 의존성 없음)

const CONTENT_MIN_LENGTH = 1;
const CONTENT_MAX_LENGTH = 500;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 50;

const ISBN13_PATTERN = /^97[89][0-9]{10}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const BIGINT_MAX = '9223372036854775807'; // comments.id는 bigint

// 글자 수 (한글·이모지도 1글자로 센다. DB의 char_length와 같은 기준)
const charLength = (str) => [...str].length;

const fail = (message) => ({ ok: false, message });

const isValidIsbn13 = (isbn) => typeof isbn === 'string' && ISBN13_PATTERN.test(isbn);

// 양의 bigint 문자열이면 그대로, 아니면 null (JS Number로 바꾸면 정밀도를 잃으므로 문자열 유지)
const parseBigintId = (raw) => {
  if (typeof raw !== 'string' || !POSITIVE_INTEGER_PATTERN.test(raw)) return null;
  if (raw.length > BIGINT_MAX.length) return null;
  if (raw.length === BIGINT_MAX.length && raw > BIGINT_MAX) return null;
  return raw;
};

// 댓글 작성 검증. 통과하면 { ok: true, value: { isbn, content } } (content는 trim한 값)
const validateCreateComment = (body) => {
  const { isbn, content } = body || {};

  if (!isValidIsbn13(isbn)) {
    return fail('ISBN13 형식(13자리 숫자)이 올바르지 않습니다.');
  }
  if (typeof content !== 'string') {
    return fail('댓글 내용을 입력해 주세요.');
  }

  const trimmed = content.trim();
  const length = charLength(trimmed);
  if (length < CONTENT_MIN_LENGTH) {
    return fail('댓글 내용을 입력해 주세요.');
  }
  if (length > CONTENT_MAX_LENGTH) {
    return fail(`댓글은 ${CONTENT_MAX_LENGTH}자 이하로 입력해 주세요.`);
  }

  return { ok: true, value: { isbn, content: trimmed } };
};

// 목록 조회 쿼리 검증. 통과하면 { ok: true, value: { isbn, limit, before } } (before는 없으면 null)
const validateListQuery = (query) => {
  const { isbn, limit, before } = query || {};

  if (!isValidIsbn13(isbn)) {
    return fail('ISBN13 형식(13자리 숫자)이 올바르지 않습니다.');
  }

  let parsedLimit = LIST_DEFAULT_LIMIT;
  if (limit !== undefined) {
    if (typeof limit !== 'string' || !POSITIVE_INTEGER_PATTERN.test(limit)) {
      return fail('limit은 1 이상의 정수여야 합니다.');
    }
    parsedLimit = Math.min(Number(limit), LIST_MAX_LIMIT);
  }

  let parsedBefore = null;
  if (before !== undefined) {
    parsedBefore = parseBigintId(before);
    if (parsedBefore === null) {
      return fail('before 값이 올바르지 않습니다.');
    }
  }

  return { ok: true, value: { isbn, limit: parsedLimit, before: parsedBefore } };
};

module.exports = {
  parseBigintId,
  validateCreateComment,
  validateListQuery,
};
