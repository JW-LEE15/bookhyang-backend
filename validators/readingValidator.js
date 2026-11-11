// validators/readingValidator.js: 독서 기록(완독일) 입력 검증 (외부 의존성 없음)
const { todayKst } = require('../services/kstDate');

const PG_INTEGER_MAX = 2147483647; // user_books.id는 integer
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MIN_YEAR = 1900;

const fail = (message) => ({ ok: false, message });

// URL의 user_books id가 양의 정수(integer 범위)면 숫자로, 아니면 null
const parseUserBookId = (raw) => {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return id <= PG_INTEGER_MAX ? id : null;
};

// 실제 달력에 있는 날짜인지 (2026-02-30 불가, 윤년 처리)
const isRealCalendarDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const NOTE_MIN_LENGTH = 1;
const NOTE_MAX_LENGTH = 2000;

// 글자 수 (한글·이모지도 1글자로 센다. DB의 char_length와 같은 기준)
const charLength = (str) => [...str].length;

// 메모 내용 검증. 통과하면 { ok: true, value: { content } } (content는 trim한 값, 내부 줄바꿈은 유지)
// \u0000은 Postgres text에 저장할 수 없어서(500이 되므로) 거부한다.
const validateNoteContent = (body) => {
  const raw = body && body.content;
  if (typeof raw !== 'string') {
    return fail('메모 내용을 입력해 주세요.');
  }
  if (raw.includes('\u0000')) {
    return fail('메모에 사용할 수 없는 문자가 있습니다.');
  }
  const trimmed = raw.trim();
  const length = charLength(trimmed);
  if (length < NOTE_MIN_LENGTH) {
    return fail('메모 내용을 입력해 주세요.');
  }
  if (length > NOTE_MAX_LENGTH) {
    return fail(`메모는 ${NOTE_MAX_LENGTH}자 이하로 입력해 주세요.`);
  }
  return { ok: true, value: { content: trimmed } };
};

const SUMMARY_RECENT_DEFAULT = 5;
const SUMMARY_RECENT_MAX = 10;
const PERIOD_LIMIT_DEFAULT = 50;
const PERIOD_LIMIT_MAX = 200;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

// 'YYYY-MM-DD' 형식이고 실제 달력에 있는 날짜(1900년 이후)인지. 미래 날짜 여부는 보지 않는다.
const isValidDateString = (raw) => {
  const match = typeof raw === 'string' ? DATE_PATTERN.exec(raw) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= MIN_YEAR && isRealCalendarDate(year, month, day);
};

// 독서 기록 요약 조회 쿼리(recent) 검증. 통과하면 { ok: true, value: { recent } }
// recent는 1~10의 정수이고 없으면 5. 범위를 벗어나면 줄이지 않고 거부한다.
const validateSummaryQuery = (query) => {
  const raw = query && query.recent;
  if (raw === undefined) return { ok: true, value: { recent: SUMMARY_RECENT_DEFAULT } };
  if (typeof raw !== 'string' || !POSITIVE_INTEGER_PATTERN.test(raw) || Number(raw) > SUMMARY_RECENT_MAX) {
    return fail(`recent는 1 이상 ${SUMMARY_RECENT_MAX} 이하의 정수여야 합니다.`);
  }
  return { ok: true, value: { recent: Number(raw) } };
};

// 기간별 조회(AI 리포트용) 인자 검증. 기간은 [from, to) 반개구간이고 YYYY-MM-DD(한국 날짜)이다.
// limit은 없으면 50, 양의 정수만 허용하고 200을 넘으면 200으로 줄인다.
// 통과하면 { ok: true, value: { from, to, limit } }
const validatePeriod = ({ from, to, limit } = {}) => {
  if (!isValidDateString(from) || !isValidDateString(to)) {
    return fail('기간은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  }
  if (from >= to) {
    return fail('기간의 시작일은 종료일보다 앞이어야 합니다.');
  }
  let parsedLimit = PERIOD_LIMIT_DEFAULT;
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) {
      return fail('limit은 1 이상의 정수여야 합니다.');
    }
    parsedLimit = Math.min(limit, PERIOD_LIMIT_MAX);
  }
  return { ok: true, value: { from, to, limit: parsedLimit } };
};

const STATUSES = ['READING', 'COMPLETED', 'WISH'];
const STATUS_ERROR_MESSAGE = '독서 상태는 READING, COMPLETED, WISH 중 하나여야 합니다.';

// 독서 상태 검증. 대소문자만 다른 값('completed')은 대문자로 바꿔 받고, 그 밖의 값은 거부한다. (공백 제거는 하지 않는다)
// 통과하면 { ok: true, value: 'COMPLETED' }
const normalizeStatus = (raw) => {
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase();
    if (STATUSES.includes(upper)) return { ok: true, value: upper };
  }
  return fail(STATUS_ERROR_MESSAGE);
};

// 완독일 수정 검증. 통과하면 { ok: true, value: { readEndDate } }
// now는 테스트용으로 주입한다. 미래(한국 시간 오늘 이후) 날짜는 거부한다.
const validateReadEndDate = (body, now = new Date()) => {
  const raw = body && body.read_end_date;
  if (typeof raw !== 'string') {
    return fail('완독일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  const match = DATE_PATTERN.exec(raw);
  if (!match) {
    return fail('완독일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR || !isRealCalendarDate(year, month, day)) {
    return fail('존재하지 않는 날짜입니다.');
  }
  if (raw > todayKst(now)) {
    return fail('완독일은 오늘 이후로 정할 수 없습니다.');
  }
  return { ok: true, value: { readEndDate: raw } };
};

module.exports = {
  STATUSES,
  NOTE_MAX_LENGTH,
  SUMMARY_RECENT_DEFAULT,
  SUMMARY_RECENT_MAX,
  PERIOD_LIMIT_DEFAULT,
  PERIOD_LIMIT_MAX,
  validateSummaryQuery,
  validatePeriod,
  parseUserBookId,
  normalizeStatus,
  validateReadEndDate,
  validateNoteContent,
};
