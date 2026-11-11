// services/readingRecords.js: 독서 기록(완독일 등) DB 로직
// pool을 인자로 받아서 라우트와 이후 AI 리포트가 같이 쓴다. 모든 쿼리에 user_id 조건을 넣어 소유자를 확인한다.
// 남의 도서와 없는 도서는 똑같이 not_found로 돌려준다.

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

module.exports = { updateReadEndDate };
