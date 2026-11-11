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

module.exports = { STATUSES, parseUserBookId, normalizeStatus, validateReadEndDate };
