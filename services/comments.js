// services/comments.js: 댓글 응답 조립과 AI 요약 입력 조립 (PR1: 순수 함수만. DB 함수는 PR2·PR3에서 이 파일에 추가)
// 이 파일에는 로그 출력이 없다. 댓글 원문을 로그에 남기지 않는다.

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

module.exports = {
  HIDDEN_PLACEHOLDER,
  DELETED_PLACEHOLDER,
  SUMMARY_MAX_COMMENTS,
  maskComment,
  buildSummaryInput,
};
