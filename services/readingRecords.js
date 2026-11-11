// services/readingRecords.js: 독서 기록(완독일 등) DB 로직
// pool을 인자로 받아서 라우트와 이후 AI 리포트가 같이 쓴다. 모든 쿼리에 user_id 조건을 넣어 소유자를 확인한다.
// 남의 도서와 없는 도서는 똑같이 not_found로 돌려준다.
const { monthRangeKst } = require('./kstDate');
const { validatePeriod, SUMMARY_RECENT_DEFAULT } = require('../validators/readingValidator');

// 완독 상태인 내 도서의 완독일을 바꾼다.
// 반환: { result: 'ok', data } | { result: 'not_found' } | { result: 'not_completed' }
const updateReadEndDate = async (pool, { userId, id, readEndDate }) => {
  const updated = await pool.query(
    `UPDATE user_books
        SET read_end_date = $1::date
      WHERE id = $2 AND user_id = $3 AND status = 'COMPLETED'
      RETURNING id, status, read_end_date`,
    [readEndDate, id, userId]
  );
  if (updated.rowCount > 0) {
    return { result: 'ok', data: updated.rows[0] };
  }

  // 0행: 내 도서가 아니거나 없는 것인지, 내 도서인데 완독이 아닌 것인지 구분한다 (user_id 조건 포함)
  const owned = await pool.query('SELECT 1 FROM user_books WHERE id = $1 AND user_id = $2', [id, userId]);
  return { result: owned.rowCount > 0 ? 'not_completed' : 'not_found' };
};

// ---- 메모 (책 하나에 메모 하나, 항상 비공개) ----
// 메모 내용은 로그에 남기지 않는다. 이 파일에는 로그 출력이 없다.
// 메모 행에는 user_id가 없어서 소유자는 항상 user_books를 조인해서 확인한다.

const NOTE_COLUMNS = 'n.id, n.user_book_id, n.content, n.created_at, n.updated_at';

// 내 도서의 메모를 조회한다.
// 반환: { result: 'ok', data: 메모 | null } (내 도서인데 메모가 없으면 data가 null) | { result: 'not_found' }
const getNote = async (pool, { userId, id }) => {
  const found = await pool.query(
    `SELECT ${NOTE_COLUMNS}
       FROM user_books ub
       LEFT JOIN reading_notes n ON n.user_book_id = ub.id
      WHERE ub.id = $1 AND ub.user_id = $2`,
    [id, userId]
  );
  if (found.rowCount === 0) return { result: 'not_found' };
  const row = found.rows[0];
  // LEFT JOIN이라 메모가 없으면 n.* 가 모두 null
  return { result: 'ok', data: row.id === null ? null : row };
};

// 내 도서의 메모를 작성하거나 수정한다. 소유 확인과 쓰기를 한 SQL에서 한다. (내 도서가 아니면 0행)
// 반환: { result: 'ok', data: 메모 } | { result: 'not_found' }
const upsertNote = async (pool, { userId, id, content }) => {
  const saved = await pool.query(
    `INSERT INTO reading_notes (user_book_id, content)
     SELECT ub.id, $3 FROM user_books ub WHERE ub.id = $1 AND ub.user_id = $2
     ON CONFLICT (user_book_id)
     DO UPDATE SET content = EXCLUDED.content, updated_at = now()
     RETURNING id, user_book_id, content, created_at, updated_at`,
    [id, userId, content]
  );
  if (saved.rowCount === 0) return { result: 'not_found' };
  return { result: 'ok', data: saved.rows[0] };
};

// 내 도서의 메모를 삭제한다.
// 반환: { result: 'ok' } | { result: 'note_not_found' } (내 도서인데 메모가 없음) | { result: 'not_found' } (없는 도서 또는 남의 도서)
const deleteNote = async (pool, { userId, id }) => {
  const deleted = await pool.query(
    `DELETE FROM reading_notes n
      USING user_books ub
      WHERE ub.id = n.user_book_id AND n.user_book_id = $1 AND ub.user_id = $2
      RETURNING n.id`,
    [id, userId]
  );
  if (deleted.rowCount > 0) return { result: 'ok' };

  // 0행: 내 도서가 아니거나 없는 것인지, 내 도서인데 메모가 없는 것인지 구분한다 (user_id 조건 포함)
  const owned = await pool.query('SELECT 1 FROM user_books WHERE id = $1 AND user_id = $2', [id, userId]);
  return { result: owned.rowCount > 0 ? 'note_not_found' : 'not_found' };
};

// ---- 독서 기록 조회 (MY 요약과 AI 독서 리포트가 같이 쓴다) ----
// 모든 함수는 pool을 첫 인자로 받고 user_id로 제한한다. 기간은 [from, to) 반개구간, YYYY-MM-DD(한국 날짜).
// listNotes는 메모 원문을 돌려준다. 이 파일에서는 메모 내용(과 사용자 정보)을 로그에 남기지 않는다.
// 메모를 AI에 보낼 때는 호출하는 쪽에서 sanitize하고 사용자 동의를 확인해야 한다.
// pg는 COUNT(bigint)를 문자열로 돌려준다
const toCount = (value) => Number(value) || 0;

// 기간 인자를 검증한다. 잘못된 값은 호출하는 코드의 실수이므로 예외를 던진다. (메시지에 입력값을 넣지 않는다)
const requirePeriod = (args) => {
  const validation = validatePeriod(args);
  if (!validation.ok) throw new Error(`기간 인자가 올바르지 않습니다: ${validation.message}`);
  return validation.value;
};

// 상태별 도서 수. total은 상태와 상관없이 내 서재의 전체 수다.
// 반환: { total, completed, reading, wish }
const countByStatus = async (pool, { userId }) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
            COUNT(*) FILTER (WHERE status = 'READING')   AS reading,
            COUNT(*) FILTER (WHERE status = 'WISH')      AS wish
       FROM user_books
      WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0] || {};
  return {
    total: toCount(row.total),
    completed: toCount(row.completed),
    reading: toCount(row.reading),
    wish: toCount(row.wish),
  };
};

// 기간 안에 완독한 도서 수 (완독일 기준)
const countCompletedInPeriod = async (pool, { userId, from, to }) => {
  const period = requirePeriod({ from, to });
  const result = await pool.query(
    `SELECT COUNT(*) AS n
       FROM user_books
      WHERE user_id = $1 AND status = 'COMPLETED'
        AND read_end_date >= $2::date AND read_end_date < $3::date`,
    [userId, period.from, period.to]
  );
  return toCount(result.rows[0] && result.rows[0].n);
};

// 내가 쓴 메모 수 (reading_notes를 user_books와 조인해서 user_id로 제한)
const countNotes = async (pool, { userId }) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS n
       FROM reading_notes n
       JOIN user_books ub ON ub.id = n.user_book_id
      WHERE ub.user_id = $1`,
    [userId]
  );
  return toCount(result.rows[0] && result.rows[0].n);
};

// 최근 완독한 책: 완독일 내림차순, 완독일이 비어 있는 옛 행은 뒤로, 같으면 id 내림차순
const listRecentCompleted = async (pool, { userId, limit = SUMMARY_RECENT_DEFAULT }) => {
  const result = await pool.query(
    `SELECT id, book_id, title, author, isbn, cover_image, read_end_date
       FROM user_books
      WHERE user_id = $1 AND status = 'COMPLETED'
      ORDER BY read_end_date DESC NULLS LAST, id DESC
      LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
};

// 기간 안에 완독한 책 목록 (AI 리포트용). 완독일이 [from, to)인 책만, 완독일 내림차순.
// limit은 기본 50, 최대 200. 분야 통계에는 book_id로 books.category를 조인하면 된다.
const listCompletedBooks = async (pool, { userId, from, to, limit }) => {
  const period = requirePeriod({ from, to, limit });
  const result = await pool.query(
    `SELECT id, book_id, title, author, isbn, cover_image, read_end_date
       FROM user_books
      WHERE user_id = $1 AND status = 'COMPLETED'
        AND read_end_date >= $2::date AND read_end_date < $3::date
      ORDER BY read_end_date DESC, id DESC
      LIMIT $4`,
    [userId, period.from, period.to, period.limit]
  );
  return result.rows;
};

// 기간 안에 작성한 메모 목록 (AI 리포트용). 작성일(created_at, 한국 날짜)이 [from, to)인 메모, 최신순.
// 메모 원문(content)이 들어 있다. limit은 기본 50, 최대 200.
const listNotes = async (pool, { userId, from, to, limit }) => {
  const period = requirePeriod({ from, to, limit });
  const result = await pool.query(
    `SELECT n.id, n.user_book_id, ub.title, ub.author, n.content, n.created_at, n.updated_at
       FROM reading_notes n
       JOIN user_books ub ON ub.id = n.user_book_id
      WHERE ub.user_id = $1
        AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date
        AND (n.created_at AT TIME ZONE 'Asia/Seoul')::date <  $3::date
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $4`,
    [userId, period.from, period.to, period.limit]
  );
  return result.rows;
};

// MY 화면용 독서 기록 요약 (순수 함수: 조회 결과를 응답 모양으로 조립)
const buildSummary = ({ month, counts, completedThisMonth, notes, recentCompleted }) => ({
  month,
  counts: {
    total: counts.total,
    completed: counts.completed,
    reading: counts.reading,
    wish: counts.wish,
    completed_this_month: completedThisMonth,
    notes,
  },
  recent_completed: recentCompleted,
});

// MY 화면용 요약. 이번 달은 한국 시간 기준이다.
const getReadingSummary = async (pool, { userId, now = new Date(), recent = SUMMARY_RECENT_DEFAULT }) => {
  const { month, from, to } = monthRangeKst(now);
  const [counts, completedThisMonth, notes, recentCompleted] = await Promise.all([
    countByStatus(pool, { userId }),
    countCompletedInPeriod(pool, { userId, from, to }),
    countNotes(pool, { userId }),
    listRecentCompleted(pool, { userId, limit: recent }),
  ]);
  return buildSummary({ month, counts, completedThisMonth, notes, recentCompleted });
};

module.exports = {
  updateReadEndDate,
  getNote,
  upsertNote,
  deleteNote,
  toCount,
  countByStatus,
  countCompletedInPeriod,
  countNotes,
  listRecentCompleted,
  listCompletedBooks,
  listNotes,
  buildSummary,
  getReadingSummary,
};
