// validators/aiValidator.js: AI 추천 요청 body 검증 (외부 의존성 없음)
// 요청: { genres: string[], topics: string[], moods: string[], useHistory: boolean, refresh?: boolean }

const GENRES = ['소설', '시', '에세이'];
const TOPICS = ['사랑', '가족', '성장', '사회', '철학', '역사', '일상', '삶과 죽음'];
const MOODS = ['따뜻한', '잔잔한', '깊이 있는', '유쾌한', '어두운', '몰입감 있는'];

const MAX_GENRES = 3;
const MAX_TOPICS = 3;
const MAX_MOODS = 2;

const fail = (message) => ({ ok: false, message });

// 허용값 배열 검증. 필드가 없으면 빈 배열, 중복은 제거한 뒤 개수를 센다.
// 통과하면 { ok: true, value }, 아니면 { ok: false, message }
const validateChoices = (value, { label, allowed, max }) => {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail(`${label}는 배열이어야 합니다.`);

  const unique = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      return fail(`${label}에 허용되지 않는 값이 있습니다.`);
    }
    if (!unique.includes(item)) unique.push(item);
  }
  if (unique.length > max) return fail(`${label}는 최대 ${max}개까지 고를 수 있습니다.`);
  return { ok: true, value: unique };
};

// 불리언 필드: 없으면 false, 불리언이 아니면 실패
const validateFlag = (value, label) => {
  if (value === undefined) return { ok: true, value: false };
  if (typeof value !== 'boolean') return fail(`${label}는 true 또는 false여야 합니다.`);
  return { ok: true, value };
};

// 통과하면 { ok: true, value: { genres, topics, moods, useHistory, refresh } }
const validateRecommendRequest = (body) => {
  if (body === undefined || body === null) {
    body = {};
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return fail('요청 형식이 올바르지 않습니다.');
  }

  const genres = validateChoices(body.genres, { label: 'genres', allowed: GENRES, max: MAX_GENRES });
  if (!genres.ok) return genres;
  const topics = validateChoices(body.topics, { label: 'topics', allowed: TOPICS, max: MAX_TOPICS });
  if (!topics.ok) return topics;
  const moods = validateChoices(body.moods, { label: 'moods', allowed: MOODS, max: MAX_MOODS });
  if (!moods.ok) return moods;
  const useHistory = validateFlag(body.useHistory, 'useHistory');
  if (!useHistory.ok) return useHistory;
  const refresh = validateFlag(body.refresh, 'refresh');
  if (!refresh.ok) return refresh;

  return {
    ok: true,
    value: {
      genres: genres.value,
      topics: topics.value,
      moods: moods.value,
      useHistory: useHistory.value,
      refresh: refresh.value,
    },
  };
};

module.exports = {
  GENRES,
  TOPICS,
  MOODS,
  MAX_GENRES,
  MAX_TOPICS,
  MAX_MOODS,
  validateRecommendRequest,
};
