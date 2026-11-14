// test/comments.test.js: 댓글 응답 마스킹과 AI 요약 입력 조립 (순수 함수, DB 접속 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HIDDEN_PLACEHOLDER,
  DELETED_PLACEHOLDER,
  maskComment,
  buildSummaryInput,
} = require('../services/comments');
const { describeError } = require('../services/safeError');

const SECRET = '비밀-댓글-원문-SENTINEL';
const AUTHOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const baseRow = (overrides = {}) => ({
  id: '10',
  isbn: '9788937460777',
  user_id: AUTHOR,
  content: SECRET,
  created_at: '2026-11-12T00:00:00.000Z',
  nickname: '작성자',
  parent_id: null,
  is_spoiler: false,
  is_hidden: false,
  deleted_at: null,
  reply_count: '3', // pg는 COUNT를 문자열로 준다
  ...overrides,
});

// ---- maskComment ----

test('보통 댓글: 기존 필드는 그대로, 새 필드는 기본값', () => {
  const out = maskComment(baseRow(), OTHER);
  assert.equal(out.id, '10');
  assert.equal(out.isbn, '9788937460777');
  assert.equal(out.user_id, AUTHOR);
  assert.equal(out.content, SECRET);
  assert.equal(out.created_at, '2026-11-12T00:00:00.000Z');
  assert.equal(out.nickname, '작성자');
  assert.equal(out.parent_id, null);
  assert.equal(out.is_spoiler, false);
  assert.equal(out.is_hidden, false);
  assert.equal(out.is_deleted, false);
  assert.equal(out.content_masked, false);
  assert.equal(out.is_mine, false);
  assert.equal(out.reply_count, 3);
});

test('is_mine: 본인만 true, 비로그인(null·생략)은 false', () => {
  assert.equal(maskComment(baseRow(), AUTHOR).is_mine, true);
  assert.equal(maskComment(baseRow(), OTHER).is_mine, false);
  assert.equal(maskComment(baseRow(), null).is_mine, false);
  assert.equal(maskComment(baseRow()).is_mine, false);
});

test('숨김 댓글: 타인과 비로그인에게는 원문이 응답에 없고, 닉네임과 user_id는 유지', () => {
  for (const viewer of [OTHER, null, undefined]) {
    const out = maskComment(baseRow({ is_hidden: true }), viewer);
    assert.equal(out.content, HIDDEN_PLACEHOLDER);
    assert.equal(out.is_hidden, true);
    assert.equal(out.content_masked, true);
    assert.equal(out.nickname, '작성자');
    assert.equal(out.user_id, AUTHOR);
    assert.equal(JSON.stringify(out).includes(SECRET), false);
  }
});

test('숨김 댓글: 작성자 본인에게는 원문이 보이고 숨김 상태가 표시된다', () => {
  const out = maskComment(baseRow({ is_hidden: true }), AUTHOR);
  assert.equal(out.content, SECRET);
  assert.equal(out.is_hidden, true);
  assert.equal(out.content_masked, false);
  assert.equal(out.is_mine, true);
});

test('삭제 표시 댓글: user_id·nickname은 null, 내용은 안내 문구, 본인도 is_mine false', () => {
  const row = baseRow({ deleted_at: '2026-11-12T01:00:00.000Z', content: '', is_hidden: true, is_spoiler: true });
  for (const viewer of [AUTHOR, OTHER, null]) {
    const out = maskComment(row, viewer);
    assert.equal(out.user_id, null);
    assert.equal(out.nickname, null);
    assert.equal(out.content, DELETED_PLACEHOLDER);
    assert.equal(out.is_deleted, true);
    assert.equal(out.content_masked, true);
    assert.equal(out.is_hidden, false);
    assert.equal(out.is_spoiler, false);
    assert.equal(out.is_mine, false);
  }
});

test('스포일러 댓글: 내용은 그대로 보내고 표시만 한다', () => {
  const out = maskComment(baseRow({ is_spoiler: true }), OTHER);
  assert.equal(out.is_spoiler, true);
  assert.equal(out.content, SECRET);
  assert.equal(out.content_masked, false);
});

test('답글: parent_id는 문자열, reply_count는 0이다', () => {
  const out = maskComment(baseRow({ id: '11', parent_id: '10', reply_count: '5' }), OTHER);
  assert.equal(out.parent_id, '10');
  assert.equal(out.reply_count, 0);
});

test('응답에는 지정한 필드만 들어간다 (deleted_at 등 내부 컬럼 제외)', () => {
  const out = maskComment(baseRow({ extra_secret: 'x' }), OTHER);
  assert.deepEqual(Object.keys(out).sort(), [
    'content', 'content_masked', 'created_at', 'id', 'is_deleted', 'is_hidden', 'is_mine',
    'is_spoiler', 'isbn', 'nickname', 'parent_id', 'profile_image_url', 'reply_count', 'user_id',
  ]);
  // 사진 바이트와 올린 시각 원본은 응답에 나오지 않는다
  const withImage = maskComment(baseRow({ profile_image: Buffer.from('x'), profile_image_updated_at: new Date(1700000000000) }), OTHER);
  assert.equal('profile_image' in withImage, false);
  assert.equal('profile_image_updated_at' in withImage, false);
});

// ---- profile_image_url ----

test('profile_image_url: 사진이 없으면 null, 있으면 사용자 id와 올린 시각(ms)으로 만든 상대 경로', () => {
  assert.equal(maskComment(baseRow(), OTHER).profile_image_url, null);
  assert.equal(maskComment(baseRow({ profile_image_updated_at: null }), OTHER).profile_image_url, null);
  const date = new Date(1700000000000);
  assert.equal(
    maskComment(baseRow({ profile_image_updated_at: date }), OTHER).profile_image_url,
    `/api/users/${AUTHOR}/profile-image?v=1700000000000`
  );
  // 문자열 시각도 같은 값이 나온다
  assert.equal(
    maskComment(baseRow({ profile_image_updated_at: date.toISOString() }), OTHER).profile_image_url,
    `/api/users/${AUTHOR}/profile-image?v=1700000000000`
  );
});

test('profile_image_url: 숨김 댓글은 닉네임처럼 유지하고, 삭제 표시 댓글은 null', () => {
  const updated = new Date(1700000000000);
  const hidden = maskComment(baseRow({ is_hidden: true, profile_image_updated_at: updated }), OTHER);
  assert.equal(hidden.profile_image_url, `/api/users/${AUTHOR}/profile-image?v=1700000000000`);
  const deleted = maskComment(
    baseRow({ deleted_at: '2026-11-12T01:00:00.000Z', content: '', profile_image_updated_at: updated }),
    OTHER
  );
  assert.equal(deleted.profile_image_url, null);
  assert.equal(JSON.stringify(deleted).includes(AUTHOR), false); // 삭제 표시 댓글에는 user_id가 어디에도 없다
});

test('profile_image_url: 올바른 uuid가 아닌 user_id나 이상한 시각이면 null (URL을 만들지 않는다)', () => {
  assert.equal(maskComment(baseRow({ user_id: 'not-a-uuid', profile_image_updated_at: new Date(1) }), OTHER).profile_image_url, null);
  assert.equal(maskComment(baseRow({ profile_image_updated_at: 'garbage' }), OTHER).profile_image_url, null);
});

// ---- buildSummaryInput ----

const root = (id, extra = {}) => ({ id: String(id), content: `원댓글${id}`, created_at: `t${id}`, is_spoiler: false, ...extra });
const reply = (id, parentId, extra = {}) => ({
  id: String(id), parent_id: String(parentId), content: `답글${id}`, created_at: `t${id}`, is_spoiler: false, ...extra,
});

test('요약 입력: 원댓글과 답글이 연결되고 오래된 스레드가 먼저 나온다', () => {
  const out = buildSummaryInput(
    [root(30), root(10), root(20)],
    [reply(31, 30), reply(12, 10), reply(11, 10)]
  );
  assert.deepEqual(out.threads.map((t) => t.id), ['10', '20', '30']);
  assert.deepEqual(out.threads[0].replies.map((r) => r.id), ['11', '12']);
  assert.deepEqual(out.threads[1].replies, []);
  assert.deepEqual(out.threads[2].replies.map((r) => [r.id, r.parent_id]), [['31', '30']]);
  assert.deepEqual(out.counts, { total: 6, roots: 3, replies: 3 });
});

test('요약 입력: 입력 순서가 달라도 출력이 같다', () => {
  const roots = [root(1), root(2), root(3)];
  const replies = [reply(4, 1), reply(5, 1), reply(6, 3)];
  const a = buildSummaryInput(roots, replies);
  const b = buildSummaryInput([...roots].reverse(), [...replies].reverse());
  assert.deepEqual(a, b);
});

test('요약 입력: 부모가 대상에서 빠진 답글은 버린다', () => {
  const out = buildSummaryInput([root(10)], [reply(11, 10), reply(21, 20)]);
  assert.deepEqual(out.threads.map((t) => t.id), ['10']);
  assert.equal(out.counts.replies, 1);
});

test('요약 입력: 최대 100개(원댓글+답글)를 넘지 않고 최신 스레드부터 담는다', () => {
  const roots = Array.from({ length: 150 }, (_, i) => root(i + 1));
  const out = buildSummaryInput(roots, []);
  assert.equal(out.counts.total, 100);
  assert.equal(out.threads[0].id, '51');
  assert.equal(out.threads[99].id, '150');
});

test('요약 입력: 마지막 스레드는 답글을 일부만 담아 100개를 맞춘다', () => {
  const roots = [root(1000), root(900)];
  const replies = Array.from({ length: 120 }, (_, i) => reply(2000 + i, 1000)).concat([reply(3000, 900)]);
  const out = buildSummaryInput(roots, replies);
  assert.equal(out.counts.total, 100);
  assert.equal(out.threads.length, 1); // 최신 스레드가 예산을 다 쓴다
  assert.equal(out.threads[0].id, '1000');
  assert.equal(out.threads[0].replies.length, 99);
  assert.equal(out.threads[0].replies[0].id, '2000'); // 답글은 오래된 순
});

test('요약 입력: max 지정과 잘못된 max', () => {
  const out = buildSummaryInput([root(1), root(2), root(3)], [reply(4, 3)], { max: 3 });
  assert.equal(out.counts.total, 3);
  assert.deepEqual(out.threads.map((t) => t.id), ['2', '3']);
  for (const max of [0, 101, 1.5, '5', NaN]) {
    assert.throws(() => buildSummaryInput([], [], { max }));
  }
});

test('요약 입력: user_id·nickname 같은 다른 필드는 담지 않고, 같은 id는 한 번만 쓴다', () => {
  const out = buildSummaryInput(
    [root(1, { user_id: AUTHOR, nickname: '닉' }), root(1)],
    [reply(2, 1, { user_id: OTHER, nickname: '닉2' }), reply(2, 1)]
  );
  assert.equal(out.counts.total, 2);
  assert.deepEqual(Object.keys(out.threads[0]).sort(), ['content', 'created_at', 'id', 'is_spoiler', 'replies']);
  assert.deepEqual(Object.keys(out.threads[0].replies[0]).sort(), ['content', 'created_at', 'id', 'is_spoiler', 'parent_id']);
});

test('요약 입력: 빈 입력', () => {
  assert.deepEqual(buildSummaryInput([], []), { threads: [], counts: { total: 0, roots: 0, replies: 0 } });
});

test('요약 입력과 마스킹은 console에 아무것도 출력하지 않는다', () => {
  const originals = {};
  const written = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[method] = console[method];
    console[method] = (...args) => written.push(args.join(' '));
  }
  try {
    maskComment(baseRow({ is_hidden: true }), OTHER);
    buildSummaryInput([root(1, { content: SECRET })], [reply(2, 1, { content: SECRET })]);
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }
  assert.deepEqual(written, []);
});

// ---- describeError ----

test('describeError: 이름과 DB 오류 코드만 남기고 message·detail은 남기지 않는다', () => {
  const error = Object.assign(new Error(`Failing row contains (${SECRET})`), {
    name: 'error',
    code: '23514',
    detail: `Failing row contains (${SECRET})`,
  });
  const text = describeError(error);
  assert.equal(text, 'name=error dbCode=23514');
  assert.equal(text.includes(SECRET), false);
});

test('describeError: 이상한 값은 unknown으로 바꾼다', () => {
  assert.equal(describeError(null), 'name=unknown dbCode=unknown');
  assert.equal(describeError(undefined), 'name=unknown dbCode=unknown');
  assert.equal(describeError('문자열'), 'name=unknown dbCode=unknown');
  assert.equal(describeError({ name: '댓글 원문 흉내', code: 'a b' }), 'name=unknown dbCode=unknown');
  assert.equal(describeError({ name: 'Error', code: 'ECONNREFUSED' }), 'name=Error dbCode=ECONNREFUSED');
});
