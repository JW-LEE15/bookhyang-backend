// services/kstDate.js: 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준 날짜 계산 (순수 함수)
// Render 서버는 UTC라서 새벽 0~9시에 서버 날짜를 그대로 쓰면 하루 어긋난다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// now(Date)의 한국 날짜를 'YYYY-MM-DD'로
const todayKst = (now = new Date()) => new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

module.exports = { todayKst };
