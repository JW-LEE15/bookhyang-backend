// services/readingReportStore.js: AI 독서 리포트의 DB 로직 (통계 조회, 저장, 목록, 삭제)
// pool을 인자로 받는다. 모든 쿼리에 user_id 조건을 넣어 소유자를 확인한다. 남의 리포트와 없는 리포트는 똑같이 0행이다.
// 이 파일에는 로그 출력이 없다. 메모 원문과 리포트 내용은 어디에도 남기지 않는다.
const { toCount } = require('./readingRecords');
const { validatePeriod } = require('../validators/readingValidator');

const LIST_LIMIT = 20; // 목록은 최신 20개 고정 (페이지네이션은 범위 밖)
const REPORT_ID_PATTERN = /^[1-9][0-9]{0,14}$/; // bigint지만 JS 안전 정수 범위(15자리)까지만 받는다

// 분야 통계의 고정 순서. NULL(미분류)은 맨 뒤.
const CATEGORY_ORDER = ['소설', '시', '에세이'];

// 고정 분야 순서, 그 밖의 값(CHECK 제약상 없어야 하지만), 맨 뒤에 NULL(미분류)
const categoryRank = (category) => {
  if (category === null) return 99;
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? 98 : index;
};

const REPORT_COLUMNS =
  'id, period_type, period_from, period_to, include_notes, stats, report, created_at';

// URL의 리포트 id가 양의 정수 문자열이면 그대로(문자열), 아니면 null
const parseReportId = (raw) => (typeof raw === 'string' && REPORT_ID_PATTERN.test(raw) ? raw : null);

// 기간 인자를 검증한다. 잘못된 값은 호출하는 코드의 실수이므로 예외를 던진다. (메시지에 입력값을 넣지 않는다)
const requirePeriod = (args) => {
  const validation = validatePeriod(args);
  if (!validation.ok) throw new Error(`기간 인자가 올바르지 않습니다: ${validation.message}`);
  return validation.value;
};

// 기간 안(완독일 [from, to)) 완독한 책의 분야별 수와 전체 수. books.category는 대부분 NULL이라 null(미분류)로 나온다.
// user_books.book_id는 NULL일 수 있어서 LEFT JOIN이다. 반환: { completedCount, byCategory: [{ category, count }] }
const getCompletedStats = async (pool, { userId, from, to }) => {
  const period = requirePeriod({ from, to });
  const result = await pool.query(
    `SELECT b.category AS category, COUNT(*) AS n
       FROM user_books ub
       LEFT JOIN books b ON b.id = ub.book_id
      WHERE ub.user_id = $1 AND ub.status = 'COMPLETED'
        AND ub.read_end_date >= $2::date AND ub.read_end_date < $3::date
      GROUP BY b.category`,
    [userId, period.from, period.to]
  );
  const byCategory = result.rows
    .map((row) => ({ category: row.category === null || row.category === undefined ? null : row.category, count: toCount(row.n) }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  return { completedCount: byCategory.reduce((sum, row) => sum + row.count, 0), byCategory };
};

// 기간 안(작성일 [from, to), 한국 날짜)에 쓴 메모 수. reading_notes는 user_books를 조인해서 user_id로 제한한다.
const countNotesInPeriod = async (pool, { userId, from, to }) => {
  const period = requirePeriod({ from, to });
  const result = await pool.query(
    `SELECT COUNT(*) AS n
       FROM reading_notes n
       JOIN user_books ub ON ub.id = n.user_book_id
      WHERE ub.user_id = $1
        AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date
        AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date <  $3::date`,
    [userId, period.from, period.to]
  );
  return toCount(result.rows[0] && result.rows[0].n);
};

// 리포트 한 건을 저장하고 저장된 행을 돌려준다. stats와 report는 jsonb로 저장한다.
const insertReport = async (pool, { userId, periodType, from, to, includeNotes, stats, report, promptVersion }) => {
  const saved = await pool.query(
    `INSERT INTO reading_reports
       (user_id, period_type, period_from, period_to, include_notes, stats, report, prompt_version)
     VALUES ($1, $2, $3::date, $4::date, $5, $6::jsonb, $7::jsonb, $8)
     RETURNING ${REPORT_COLUMNS}`,
    [userId, periodType, from, to, includeNotes === true, JSON.stringify(stats), JSON.stringify(report), promptVersion]
  );
  return saved.rows[0];
};

// 내 리포트 목록: 최신순 LIST_LIMIT개
const listReports = async (pool, { userId }) => {
  const result = await pool.query(
    `SELECT ${REPORT_COLUMNS}
       FROM reading_reports
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT $2`,
    [userId, LIST_LIMIT]
  );
  return result.rows;
};

// 내 리포트를 삭제한다. 남의 리포트와 없는 리포트는 똑같이 false.
const deleteReport = async (pool, { userId, id }) => {
  const deleted = await pool.query('DELETE FROM reading_reports WHERE id = $1::bigint AND user_id = $2 RETURNING id', [id, userId]);
  return deleted.rowCount > 0;
};

// 저장된 행 -> API 응답의 Report. id는 문자열, 날짜는 'YYYY-MM-DD', 시각은 ISO 문자열.
const toIso = (value) => (value instanceof Date ? value.toISOString() : value);
const toDateText = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

const buildReportResponse = (row) => ({
  id: String(row.id),
  generated_at: toIso(row.created_at),
  period: {
    type: row.period_type,
    label: String(toDateText(row.period_from)).slice(0, 7),
    from: toDateText(row.period_from),
    to: toDateText(row.period_to),
  },
  include_notes: row.include_notes === true,
  stats: row.stats,
  report: row.report,
});

module.exports = {
  LIST_LIMIT,
  CATEGORY_ORDER,
  parseReportId,
  getCompletedStats,
  countNotesInPeriod,
  insertReport,
  listReports,
  deleteReport,
  buildReportResponse,
};
