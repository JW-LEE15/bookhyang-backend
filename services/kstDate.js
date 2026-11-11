// services/kstDate.js: 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준 날짜 계산 (순수 함수)
// Render 서버는 UTC라서 새벽 0~9시에 서버 날짜를 그대로 쓰면 하루 어긋난다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// now(Date)의 한국 날짜를 'YYYY-MM-DD'로
const todayKst = (now = new Date()) => new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

// now(Date)가 속한 한국 달의 범위. from은 그 달 1일, to는 다음 달 1일이다 ([from, to) 반개구간)
// 예: 2026-11-11 -> { month: '2026-11', from: '2026-11-01', to: '2026-12-01' }
const monthRangeKst = (now = new Date()) => {
  const today = todayKst(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const pad = (value) => String(value).padStart(2, '0');
  return {
    month: `${year}-${pad(month)}`,
    from: `${year}-${pad(month)}-01`,
    to: `${nextYear}-${pad(nextMonth)}-01`,
  };
};

module.exports = { todayKst, monthRangeKst };
