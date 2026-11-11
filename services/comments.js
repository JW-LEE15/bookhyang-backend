// services/comments.js: 댓글 응답 조립, 댓글 DB 로직, AI 요약 입력 조립
//  - 순수 함수: maskComment, buildSummaryInput
//  - DB 함수(pool을 첫 인자로 받는다): listComments, listReplies, createComment, setHidden, deleteComment,
//    listCommentsForSummary (AI 요약 입력용 조회)
// 이 파일에는 로그 출력이 없다. 댓글 원문을 로그에 남기지 않는다.
// 모든 쓰기 쿼리에 user_id 조건을 넣어 소유자를 확인한다. 남의 댓글과 없는 댓글은 똑같이 not_found로 돌려준다.
const { isValidIsbn13 } = require('../validators/commentValidator');

const HIDDEN_PLACEHOLDER = '숨겨진 댓글입니다.';
const DELETED_PLACEHOLDER = '삭제된 댓글입니다.';
const SUMMARY_MAX_COMMENTS = 100; // 요약 입력 최대 댓글 수 (원댓글 + 답글)

// pg는 COUNT(bigint)를 문자열로 돌려준다
const toCount = (value) => Number(value) || 0;

// DB 행을 응답용 댓글 객체로 바꾼다. (PR2의 목록·작성·숨김 응답이 같이 쓴다)
// 행에 필요한 컬럼: id, isbn, user_id, content, created_at, nickname, parent_id, is_spoiler, is_hidden, deleted_at, reply_count
// viewerId는 요청자 id이고 비로그인이면 null이다.
//  - 삭제 표시: user_id·nickname은 null, 내용은 안내 문구. is_hidden은 의미가 없어 false로 낸다.
//  - 숨김: 작성자 본인에게는 원문, 그 외에는 안내 문구. 닉네임과 user_id는 유지한다.
// 응답에는 지정한 필드만 담는다. 원문(content)은 마스킹하는 경우 응답에 들어가지 않는다.
const maskComment = (row, viewerId = null) => {
  const isDeleted = row.deleted_at !== null && row.deleted_at !== undefined;
  const isMine = !isDeleted && viewerId !== null && viewerId !== undefined
    && String(row.user_id) === String(viewerId);
  const isHidden = !isDeleted && row.is_hidden === true;
  const masked = isDeleted || (isHidden && !isMine);

  let content = row.content;
  if (isDeleted) content = DELETED_PLACEHOLDER;
  else if (masked) content = HIDDEN_PLACEHOLDER;

  const parentId = row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id);

  return {
    id: String(row.id),
    isbn: row.isbn,
    user_id: isDeleted ? null : row.user_id,
    content,
    created_at: row.created_at,
    nickname: isDeleted ? null : row.nickname,
    parent_id: parentId,
    is_spoiler: isDeleted ? false : row.is_spoiler === true,
    is_hidden: isHidden,
    is_deleted: isDeleted,
    content_masked: masked,
    is_mine: isMine,
    // 답글에는 답글이 없다
    reply_count: parentId === null ? toCount(row.reply_count) : 0,
  };
};

// 숫자 문자열 id를 크기로 비교한다. (bigint 범위라 BigInt로 비교)
const compareIdAsc = (a, b) => {
  const x = BigInt(a.id);
  const y = BigInt(b.id);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
};

// AI 요약 입력을 조립한다. (순수 함수)
// rootRows: 요약 대상 원댓글 (삭제·숨김·스포일러 조건은 DB 쿼리에서 이미 적용), 필드 id, content, created_at, is_spoiler
// replyRows: 요약 대상 답글, 필드 id, parent_id, content, created_at, is_spoiler
// 규칙
//  - 최대 max개(원댓글 + 답글). 최신 원댓글부터 "원댓글 + 그 답글" 스레드 단위로 담고, 마지막 스레드는 답글을 일부만 담을 수 있다.
//  - 부모가 대상에서 빠진 답글은 버린다. (맥락 없는 조각이 되고, 스포일러·숨김 부모를 인용할 수 있다)
//  - 출력은 오래된 스레드가 먼저, 스레드 안의 답글도 오래된 순이다. 같은 입력이면 항상 같은 출력이다.
//  - user_id와 nickname 등 다른 필드는 담지 않는다. (외부 AI로 나가는 데이터를 줄인다)
// 반환: { threads: [{ id, content, created_at, is_spoiler, replies: [{ id, parent_id, content, created_at, is_spoiler }] }],
//         counts: { total, roots, replies } }
const buildSummaryInput = (rootRows, replyRows, { max = SUMMARY_MAX_COMMENTS } = {}) => {
  if (!Number.isInteger(max) || max < 1 || max > SUMMARY_MAX_COMMENTS) {
    throw new Error(`max는 1 이상 ${SUMMARY_MAX_COMMENTS} 이하의 정수여야 합니다.`);
  }

  // 같은 id가 두 번 들어와도 한 번만 쓴다
  const rootsById = new Map();
  for (const row of rootRows) {
    const id = String(row.id);
    if (!rootsById.has(id)) rootsById.set(id, { ...row, id });
  }
  const repliesByParent = new Map();
  const seenReplyIds = new Set();
  for (const row of replyRows) {
    const id = String(row.id);
    const parentId = String(row.parent_id);
    if (seenReplyIds.has(id) || !rootsById.has(parentId)) continue;
    seenReplyIds.add(id);
    if (!repliesByParent.has(parentId)) repliesByParent.set(parentId, []);
    repliesByParent.get(parentId).push({ ...row, id, parent_id: parentId });
  }

  const newestFirst = [...rootsById.values()].sort((a, b) => compareIdAsc(b, a));
  let remaining = max;
  const threads = [];
  for (const root of newestFirst) {
    if (remaining <= 0) break;
    remaining -= 1;
    const replies = (repliesByParent.get(root.id) || []).sort(compareIdAsc).slice(0, remaining);
    remaining -= replies.length;
    threads.push({
      id: root.id,
      content: root.content,
      created_at: root.created_at,
      is_spoiler: root.is_spoiler === true,
      replies: replies.map((reply) => ({
        id: reply.id,
        parent_id: reply.parent_id,
        content: reply.content,
        created_at: reply.created_at,
        is_spoiler: reply.is_spoiler === true,
      })),
    });
  }

  threads.sort(compareIdAsc);
  const replyTotal = threads.reduce((sum, thread) => sum + thread.replies.length, 0);
  return {
    threads,
    counts: { total: threads.length + replyTotal, roots: threads.length, replies: replyTotal },
  };
};

// ---- DB 함수 ----

// 응답에 쓰는 컬럼. 순서와 이름은 maskComment가 읽는 행 모양과 같다.
const COMMENT_COLUMNS = `c.id, c.isbn, c.user_id, c.content, c.created_at, u.nickname,
       c.parent_id, c.is_spoiler, c.is_hidden, c.deleted_at`;
// 삭제되지 않은 답글 수 (숨김 포함). 원댓글에서만 의미가 있다.
const REPLY_COUNT_SQL = '(SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id)';
// 목록에 보여 줄 원댓글: 삭제 표시는 답글이 남아 있을 때만 보인다 (빈 껍데기는 숨긴다)
const VISIBLE_ROOT_SQL = `c.parent_id IS NULL
         AND (c.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id))`;

const toComments = (rows, viewerId) => rows.map((row) => maskComment(row, viewerId));

// 책별 원댓글 목록 (최신순, id 커서). 숨김·삭제 표시는 viewerId 기준으로 마스킹한다.
// total: 삭제되지 않은 원댓글+답글 전체 수(숨김 포함), topLevelTotal: 목록에 나오는 원댓글 수
// 반환: { data, total, topLevelTotal, nextCursor }
const listComments = async (pool, { isbn, limit, before = null, viewerId = null }) => {
  const listQuery = `
    SELECT ${COMMENT_COLUMNS}, ${REPLY_COUNT_SQL} AS reply_count
      FROM comments c
      JOIN users u ON u.id = c.user_id
     WHERE c.isbn = $1 AND ${VISIBLE_ROOT_SQL}
       AND ($2::bigint IS NULL OR c.id < $2::bigint)
     ORDER BY c.id DESC
     LIMIT $3`;
  const countQuery = `
    SELECT COUNT(*) FILTER (WHERE c.deleted_at IS NULL) AS total,
           COUNT(*) FILTER (WHERE ${VISIBLE_ROOT_SQL}) AS top_level_total
      FROM comments c
     WHERE c.isbn = $1`;

  // 다음 페이지가 있는지 알기 위해 1개 더 가져온다
  const [listResult, countResult] = await Promise.all([
    pool.query(listQuery, [isbn, before, limit + 1]),
    pool.query(countQuery, [isbn]),
  ]);

  const hasMore = listResult.rows.length > limit;
  const rows = hasMore ? listResult.rows.slice(0, limit) : listResult.rows;
  const data = toComments(rows, viewerId);
  const counts = countResult.rows[0] || {};

  return {
    data,
    total: toCount(counts.total),
    topLevelTotal: toCount(counts.top_level_total),
    nextCursor: hasMore ? data[data.length - 1].id : null,
  };
};

// 원댓글 하나의 답글 목록 (오래된 순, id > after 커서). 삭제 표시된 원댓글의 답글도 볼 수 있다.
// 반환: { result: 'ok', data, total, nextCursor } | { result: 'not_found' } (없는 댓글이거나 원댓글이 아님)
const listReplies = async (pool, { id, limit, after = null, viewerId = null }) => {
  const parent = await pool.query('SELECT 1 FROM comments WHERE id = $1 AND parent_id IS NULL', [id]);
  if (parent.rowCount === 0) return { result: 'not_found' };

  const listQuery = `
    SELECT ${COMMENT_COLUMNS}, 0 AS reply_count
      FROM comments c
      JOIN users u ON u.id = c.user_id
     WHERE c.parent_id = $1 AND ($2::bigint IS NULL OR c.id > $2::bigint)
     ORDER BY c.id ASC
     LIMIT $3`;
  const countQuery = 'SELECT COUNT(*) AS total FROM comments WHERE parent_id = $1';

  const [listResult, countResult] = await Promise.all([
    pool.query(listQuery, [id, after, limit + 1]),
    pool.query(countQuery, [id]),
  ]);

  const hasMore = listResult.rows.length > limit;
  const rows = hasMore ? listResult.rows.slice(0, limit) : listResult.rows;
  const data = toComments(rows, viewerId);

  return {
    result: 'ok',
    data,
    total: toCount(countResult.rows[0] && countResult.rows[0].total),
    nextCursor: hasMore ? data[data.length - 1].id : null,
  };
};

// 작성 직후 응답용 SELECT (닉네임을 붙인다)
const RETURNING_COLUMNS = 'id, isbn, user_id, content, created_at, parent_id, is_spoiler, is_hidden, deleted_at';
const JOIN_NICKNAME_SQL = `SELECT i.*, u.nickname, 0 AS reply_count
        FROM inserted i
        JOIN users u ON u.id = i.user_id`;

// 댓글 또는 답글을 작성한다. 작성자는 항상 userId다.
// 답글은 부모가 유효할 때만 한 번의 INSERT ... SELECT로 들어간다. (확인과 쓰기 사이에 끼어들 틈이 없다)
//   유효한 부모: 같은 책의 원댓글이고, 삭제되지 않았고, 숨김이 아님
// 반환: { result: 'ok', data }
//     | { result: 'parent_not_found' | 'reply_to_reply' | 'isbn_mismatch' | 'parent_hidden' }
const createComment = async (pool, { userId, isbn, content, parentId = null, isSpoiler = false }) => {
  if (parentId === null) {
    const inserted = await pool.query(
      `WITH inserted AS (
         INSERT INTO comments (isbn, user_id, content, is_spoiler)
         VALUES ($1, $2, $3, $4::boolean)
         RETURNING ${RETURNING_COLUMNS}
       )
       ${JOIN_NICKNAME_SQL}`,
      [isbn, userId, content, isSpoiler]
    );
    return { result: 'ok', data: maskComment(inserted.rows[0], userId) };
  }

  let inserted;
  try {
    inserted = await pool.query(
      `WITH inserted AS (
         INSERT INTO comments (isbn, user_id, content, parent_id, is_spoiler)
         SELECT $1::char(13), $2::uuid, $3::text, p.id, $5::boolean
           FROM comments p
          WHERE p.id = $4::bigint AND p.parent_id IS NULL AND p.isbn = $1::char(13)
            AND p.deleted_at IS NULL AND NOT p.is_hidden
         RETURNING ${RETURNING_COLUMNS}
       )
       ${JOIN_NICKNAME_SQL}`,
      [isbn, userId, content, parentId, isSpoiler]
    );
  } catch (error) {
    // 확인과 쓰기 사이에 부모가 지워진 경우(FK)와 DB 트리거가 막은 경우를 같은 결과로 바꾼다
    const mapped = mapReplyInsertError(error);
    if (mapped) return { result: mapped };
    throw error;
  }

  if (inserted.rowCount > 0) {
    return { result: 'ok', data: maskComment(inserted.rows[0], userId) };
  }

  // 0행: 부모가 왜 안 되는지 구분한다. 우선순위: 없음·삭제 > 답글에 답글 > 다른 책 > 숨김
  const found = await pool.query(
    'SELECT isbn, parent_id, is_hidden, deleted_at FROM comments WHERE id = $1',
    [parentId]
  );
  const parent = found.rows[0];
  if (!parent || parent.deleted_at) return { result: 'parent_not_found' };
  if (parent.parent_id !== null) return { result: 'reply_to_reply' };
  if (parent.isbn !== isbn) return { result: 'isbn_mismatch' };
  if (parent.is_hidden) return { result: 'parent_hidden' };
  return { result: 'parent_not_found' }; // 그 사이에 상태가 바뀐 경우
};

// 답글 INSERT 오류를 결과 이름으로 바꾼다. 바꿀 수 없으면 null (호출한 쪽이 그대로 던진다)
// 메시지는 20261112_comments_extend.sql 트리거가 직접 정한 고정 문자열이라 비교해도 안전하다.
const mapReplyInsertError = (error) => {
  if (!error) return null;
  if (error.code === '23503') return 'parent_not_found';
  if (error.code === '23514' && error.message === 'reply_to_reply') return 'reply_to_reply';
  if (error.code === '23514' && error.message === 'reply_isbn_mismatch') return 'isbn_mismatch';
  return null;
};

// 내 댓글을 숨기거나 숨김을 해제한다. 이미 같은 상태여도 ok (멱등).
// 반환: { result: 'ok', data } | { result: 'not_found' } (없음, 남의 댓글, 삭제 표시된 댓글 모두 같음)
const setHidden = async (pool, { userId, id, isHidden }) => {
  const updated = await pool.query(
    `WITH updated AS (
       UPDATE comments SET is_hidden = $3::boolean
        WHERE id = $1::bigint AND user_id = $2::uuid AND deleted_at IS NULL
        RETURNING ${RETURNING_COLUMNS}
     )
     SELECT i.*, u.nickname,
            (SELECT COUNT(*) FROM comments r WHERE r.parent_id = i.id) AS reply_count
       FROM updated i
       JOIN users u ON u.id = i.user_id`,
    [id, userId, isHidden]
  );
  if (updated.rowCount === 0) return { result: 'not_found' };
  return { result: 'ok', data: maskComment(updated.rows[0], userId) };
};

// 내 댓글을 삭제한다. (혼합형)
//  - 답글이 달린 원댓글: 행을 남기고 deleted_at을 채우고 내용을 비운다 -> mode 'marked'
//  - 그 밖의 댓글(답글 포함): 실제로 지운다 -> mode 'removed'
// 한 문장에서 판정과 실행을 같이 한다. 남의 댓글, 없는 댓글, 이미 삭제 표시된 댓글은 똑같이 not_found.
// 반환: { result: 'ok', mode } | { result: 'not_found' }
const deleteComment = async (pool, { userId, id }) => {
  const done = await pool.query(
    `WITH target AS (
       SELECT c.id, EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id) AS has_replies
         FROM comments c
        WHERE c.id = $1::bigint AND c.user_id = $2::uuid AND c.deleted_at IS NULL
     ),
     marked AS (
       UPDATE comments c
          SET deleted_at = now(), content = '', is_hidden = false, is_spoiler = false
         FROM target t
        WHERE c.id = t.id AND t.has_replies
        RETURNING c.id
     ),
     removed AS (
       DELETE FROM comments c
        USING target t
        WHERE c.id = t.id AND NOT t.has_replies
        RETURNING c.id
     )
     SELECT (SELECT COUNT(*) FROM marked) AS marked, (SELECT COUNT(*) FROM removed) AS removed`,
    [id, userId]
  );
  const row = done.rows[0] || {};
  if (toCount(row.marked) > 0) return { result: 'ok', mode: 'marked' };
  if (toCount(row.removed) > 0) return { result: 'ok', mode: 'removed' };
  return { result: 'not_found' };
};

// ---- AI 댓글 요약 입력 ----

// 요약 대상 조건 (원댓글과 답글에 똑같이 적용): 삭제 표시 아님, 숨김 아님, 스포일러는 includeSpoilers일 때만
// $2는 includeSpoilers(boolean)
const SUMMARY_ELIGIBLE_SQL = 'c.deleted_at IS NULL AND NOT c.is_hidden AND ($2::boolean OR NOT c.is_spoiler)';

// 책(isbn)의 댓글을 AI 요약 입력용으로 가져온다. 최대 limit개(원댓글 + 답글, 기본 100).
//  - 삭제 표시와 숨김 댓글은 항상 제외한다. 스포일러 댓글은 includeSpoilers가 true일 때만 포함한다. (기본 제외)
//  - 원댓글과 답글의 연결을 유지한다. 부모가 제외되면 그 답글도 제외한다. (buildSummaryInput 참고)
//  - 쿼리는 2개다: 최신 원댓글 limit개, 그 원댓글들의 답글(원댓글 최신순, 같은 원댓글 안에서는 오래된 순) 최대 limit개.
//    스레드마다 원댓글이 1개를 쓰므로 답글은 limit개보다 많이 필요하지 않다.
//    두 쿼리 사이에 댓글이 바뀌어도 부모가 없는 답글은 버려지므로 연결이 깨진 결과는 나오지 않는다.
//  - 반환 모양은 buildSummaryInput과 같고 include_spoilers가 붙는다.
//    { threads: [{ id, content, created_at, is_spoiler, replies: [{ id, parent_id, content, created_at, is_spoiler }] }],
//      counts: { total, roots, replies }, include_spoilers }
//    user_id와 nickname은 반환하지 않는다. id는 요약의 근거 댓글 보기·원문 이동용이다.
//  - 댓글 원문이 들어 있다. 이 함수는 로그를 남기지 않는다. 외부 AI로 보내기 전 처리는 호출하는 쪽의 몫이다.
// 잘못된 인자는 호출하는 코드의 실수이므로 예외를 던진다. (메시지에 입력값을 넣지 않는다)
const listCommentsForSummary = async (pool, { isbn, includeSpoilers = false, limit = SUMMARY_MAX_COMMENTS } = {}) => {
  if (!isValidIsbn13(isbn)) {
    throw new Error('요약 대상 isbn 인자가 올바르지 않습니다.');
  }
  if (typeof includeSpoilers !== 'boolean') {
    throw new Error('includeSpoilers 인자는 true 또는 false여야 합니다.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > SUMMARY_MAX_COMMENTS) {
    throw new Error(`limit 인자는 1 이상 ${SUMMARY_MAX_COMMENTS} 이하의 정수여야 합니다.`);
  }

  const rootsQuery = `
    SELECT c.id, c.content, c.created_at, c.is_spoiler
      FROM comments c
     WHERE c.isbn = $1 AND c.parent_id IS NULL AND ${SUMMARY_ELIGIBLE_SQL}
     ORDER BY c.id DESC
     LIMIT $3`;
  const repliesQuery = `
    WITH roots AS (
      SELECT c.id
        FROM comments c
       WHERE c.isbn = $1 AND c.parent_id IS NULL AND ${SUMMARY_ELIGIBLE_SQL}
       ORDER BY c.id DESC
       LIMIT $3
    )
    SELECT c.id, c.parent_id, c.content, c.created_at, c.is_spoiler
      FROM comments c
      JOIN roots ON roots.id = c.parent_id
     WHERE ${SUMMARY_ELIGIBLE_SQL}
     ORDER BY c.parent_id DESC, c.id ASC
     LIMIT $3`;
  const params = [isbn, includeSpoilers, limit];

  const [rootsResult, repliesResult] = await Promise.all([
    pool.query(rootsQuery, params),
    pool.query(repliesQuery, params),
  ]);

  const input = buildSummaryInput(rootsResult.rows, repliesResult.rows, { max: limit });
  return { ...input, include_spoilers: includeSpoilers };
};

module.exports = {
  HIDDEN_PLACEHOLDER,
  DELETED_PLACEHOLDER,
  SUMMARY_MAX_COMMENTS,
  maskComment,
  buildSummaryInput,
  listComments,
  listReplies,
  createComment,
  setHidden,
  deleteComment,
  listCommentsForSummary,
};
