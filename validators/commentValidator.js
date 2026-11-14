// validators/commentValidator.js: 댓글 입력값 검증 (외부 의존성 없음)

const CONTENT_MIN_LENGTH = 1;
const CONTENT_MAX_LENGTH = 500;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 50;
const REPORT_REASONS = ['spam', 'abuse', 'spoiler', 'other']; // DB CHECK(comment_reports_reason_check)와 같아야 한다
const REPORT_DETAIL_MAX_LENGTH = 200;

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

// limit 쿼리 값 해석. 없으면 기본값, 있으면 1 이상의 정수 문자열이어야 하고 최대값으로 줄인다.
const parseLimit = (limit) => {
  if (limit === undefined) return { ok: true, value: LIST_DEFAULT_LIMIT };
  if (typeof limit !== 'string' || !POSITIVE_INTEGER_PATTERN.test(limit)) {
    return fail('limit은 1 이상의 정수여야 합니다.');
  }
  return { ok: true, value: Math.min(Number(limit), LIST_MAX_LIMIT) };
};

// 커서(before/after) 쿼리 값 해석. 없으면 null.
const parseCursor = (raw, name) => {
  if (raw === undefined) return { ok: true, value: null };
  const parsed = parseBigintId(raw);
  if (parsed === null) return fail(`${name} 값이 올바르지 않습니다.`);
  return { ok: true, value: parsed };
};

// body의 parent_id 해석. 없거나 null이면 원댓글(null).
// 문자열(양의 bigint)이나 안전한 정수만 허용하고, 값은 문자열로 정리한다.
const parseParentId = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  let candidate = raw;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 1) return fail('parent_id 값이 올바르지 않습니다.');
    candidate = String(raw);
  }
  const parsed = parseBigintId(candidate);
  if (parsed === null) return fail('parent_id 값이 올바르지 않습니다.');
  return { ok: true, value: parsed };
};

// body의 is_spoiler 해석. 없거나 null이면 false. 값이 있으면 boolean만 허용한다. ("true" 문자열은 거부)
const parseSpoiler = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: false };
  if (typeof raw !== 'boolean') return fail('스포일러 여부는 true 또는 false여야 합니다.');
  return { ok: true, value: raw };
};

// 댓글 작성 검증. 통과하면 { ok: true, value: { isbn, content, parentId, isSpoiler } }
// content는 trim한 값, parentId는 없으면 null(원댓글), isSpoiler는 없으면 false
const validateCreateComment = (body) => {
  const { isbn, content, parent_id: rawParentId, is_spoiler: rawSpoiler } = body || {};

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

  const parent = parseParentId(rawParentId);
  if (!parent.ok) return parent;
  const spoiler = parseSpoiler(rawSpoiler);
  if (!spoiler.ok) return spoiler;

  return {
    ok: true,
    value: { isbn, content: trimmed, parentId: parent.value, isSpoiler: spoiler.value },
  };
};

// 목록 조회 쿼리 검증. 통과하면 { ok: true, value: { isbn, limit, before } } (before는 없으면 null)
const validateListQuery = (query) => {
  const { isbn, limit, before } = query || {};

  if (!isValidIsbn13(isbn)) {
    return fail('ISBN13 형식(13자리 숫자)이 올바르지 않습니다.');
  }

  const parsedLimit = parseLimit(limit);
  if (!parsedLimit.ok) return parsedLimit;
  const parsedBefore = parseCursor(before, 'before');
  if (!parsedBefore.ok) return parsedBefore;

  return { ok: true, value: { isbn, limit: parsedLimit.value, before: parsedBefore.value } };
};

// 답글 목록 쿼리 검증 (오래된 순이라 커서 이름이 after). 통과하면 { ok: true, value: { limit, after } }
const validateRepliesQuery = (query) => {
  const { limit, after } = query || {};

  const parsedLimit = parseLimit(limit);
  if (!parsedLimit.ok) return parsedLimit;
  const parsedAfter = parseCursor(after, 'after');
  if (!parsedAfter.ok) return parsedAfter;

  return { ok: true, value: { limit: parsedLimit.value, after: parsedAfter.value } };
};

// 숨김 변경 body 검증. is_hidden은 boolean 필수. 통과하면 { ok: true, value: { isHidden } }
const validateHiddenBody = (body) => {
  const { is_hidden: isHidden } = body || {};
  if (typeof isHidden !== 'boolean') {
    return fail('숨김 여부(is_hidden)는 true 또는 false여야 합니다.');
  }
  return { ok: true, value: { isHidden } };
};

// 신고 body 검증. reason은 REPORT_REASONS 중 하나(필수), detail은 선택(없음·null·문자열, trim 후 200자 이하).
// detail이 비어 있으면 null. 통과하면 { ok: true, value: { reason, detail } }
// 오류 메시지에는 입력값을 넣지 않는다. (detail 원문 보호)
const validateReportBody = (body) => {
  const { reason, detail: rawDetail } = body || {};

  if (typeof reason !== 'string' || !REPORT_REASONS.includes(reason)) {
    return fail('신고 사유(reason)가 올바르지 않습니다.');
  }

  let detail = null;
  if (rawDetail !== undefined && rawDetail !== null) {
    if (typeof rawDetail !== 'string') {
      return fail('신고 상세(detail)는 문자열이어야 합니다.');
    }
    const trimmed = rawDetail.trim();
    if (charLength(trimmed) > REPORT_DETAIL_MAX_LENGTH) {
      return fail(`신고 상세는 ${REPORT_DETAIL_MAX_LENGTH}자 이하로 입력해 주세요.`);
    }
    detail = trimmed === '' ? null : trimmed;
  }

  return { ok: true, value: { reason, detail } };
};

module.exports = {
  REPORT_REASONS,
  REPORT_DETAIL_MAX_LENGTH,
  validateReportBody,
  CONTENT_MAX_LENGTH,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  isValidIsbn13,
  parseBigintId,
  validateCreateComment,
  validateListQuery,
  validateRepliesQuery,
  validateHiddenBody,
};
