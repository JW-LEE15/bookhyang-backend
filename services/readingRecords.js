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

module.exports = { updateReadEndDate, getNote, upsertNote, deleteNote };
