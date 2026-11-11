// services/ai/cache.js: 작은 TTL 메모리 캐시
// 용도: 같은 사용자의 같은 추천 요청을 짧은 시간(20초) 동안 재사용해서 더블탭과 재시도로 AI 호출이 두 번 나가는 것을 막는다.
// 값으로 Promise를 넣을 수 있다. (진행 중인 요청을 다른 요청이 같이 기다리게 하는 용도)
// 서버 메모리에만 있고, 항목 수가 maxEntries를 넘으면 오래된 것부터 지운다.

const createTtlCache = ({ ttlMs, maxEntries = 500, now = Date.now }) => {
  const entries = new Map(); // key -> { value, expiresAt }

  const purgeExpired = () => {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key); // 다시 넣으면 가장 최근 항목이 된다
      if (entries.size >= maxEntries) {
        purgeExpired();
      }
      while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        entries.delete(oldestKey);
      }
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    delete(key) {
      entries.delete(key);
    },
    size() {
      purgeExpired();
      return entries.size;
    },
  };
};

module.exports = { createTtlCache };
