// services/ai/usageGuard.js: 서버 전체 하루 호출 횟수 제한 (Gemini 무료 한도를 넘기지 않기 위한 안전장치)
// - 임계값은 AI_DAILY_LIMIT의 90%를 내린 값이다. 기본 AI_DAILY_LIMIT는 500.
// - 모델 호출을 하기 직전에 reserve()로 한 칸을 예약한다. 대체 모델 호출도 센다. (실패한 호출도 센다)
// - 하루의 기준은 Google의 한도 초기화 시각에 맞춘 QUOTA_TIME_ZONE이다. 바꾸려면 아래 상수 하나만 고친다.
// - 카운터는 서버 메모리에 있어서 서버를 재시작하면 0으로 돌아간다.

const QUOTA_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_DAILY_LIMIT = 500;
const DAILY_LIMIT_RATIO = 0.9;

// 시각이 속한 하루의 키 (YYYY-MM-DD, QUOTA_TIME_ZONE 기준)
const getQuotaDayKey = (date, timeZone = QUOTA_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

// AI_DAILY_LIMIT 해석: 양의 정수 문자열이면 그 값, 아니면 기본값
const parseDailyLimit = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_DAILY_LIMIT;
  const text = String(value).trim();
  if (!/^[1-9][0-9]*$/.test(text)) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_DAILY_LIMIT;
};

// 한도의 90%를 내린 값 (예: 500 -> 450, 3 -> 2, 1 -> 0)
const computeThreshold = (dailyLimit) => Math.floor(dailyLimit * DAILY_LIMIT_RATIO);

const createUsageGuard = ({ dailyLimit, now = () => new Date(), timeZone = QUOTA_TIME_ZONE } = {}) => {
  const limit = parseDailyLimit(dailyLimit === undefined ? undefined : String(dailyLimit));
  const threshold = computeThreshold(limit);
  let currentDay = null;
  let count = 0;

  // 날짜가 바뀌었으면 카운터를 0으로 되돌린다
  const rollOver = () => {
    const day = getQuotaDayKey(now(), timeZone);
    if (day !== currentDay) {
      currentDay = day;
      count = 0;
    }
  };

  return {
    threshold,
    isExhausted() {
      rollOver();
      return count >= threshold;
    },
    // 한 번 호출할 자리를 예약한다. 임계값에 닿았으면 false
    reserve() {
      rollOver();
      if (count >= threshold) return false;
      count += 1;
      return true;
    },
    getCount() {
      rollOver();
      return count;
    },
  };
};

// 서버 전체에서 공유하는 하나의 카운터. 첫 사용 때 환경변수를 읽는다.
let sharedGuard = null;
const getSharedUsageGuard = () => {
  if (!sharedGuard) {
    sharedGuard = createUsageGuard({ dailyLimit: process.env.AI_DAILY_LIMIT });
  }
  return sharedGuard;
};

module.exports = {
  QUOTA_TIME_ZONE,
  DEFAULT_DAILY_LIMIT,
  DAILY_LIMIT_RATIO,
  getQuotaDayKey,
  parseDailyLimit,
  computeThreshold,
  createUsageGuard,
  getSharedUsageGuard,
};
