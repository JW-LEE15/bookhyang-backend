// test/commentsService.test.js: 댓글 DB 함수 (가짜 pool, DB 접속 없음)
// 쿼리 문장은 실제 DB에서 실행해 보지 않았다. 여기서는 호출 방식(파라미터, 소유자 조건, 결과 분류)을 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HIDDEN_PLACEHOLDER,
  listComments,
  listReplies,
  createComment,
  setHidden,
  deleteComment,
} = require('../services/comments');

const ISBN = '9788937460777';
const AUTHOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const SECRET = '비밀-댓글-원문-SENTINEL';

const row = (overrides = {}) => ({
  id: '10',
  isbn: ISBN,
  user_id: AUTHOR,
  content: SECRET,
  created_at: '2026-11-12T00:00:00.000Z',
  nickname: '작성자',
  parent_id: null,
  is_spoiler: false,
  is_hidden: false,
  deleted_at: null,
  reply_count: '0',
  ...overrides,
});

// 호출 기록을 남기고 handler(sql, params, callIndex)의 결과를 돌려주는 가짜 pool
// handler가 Error를 돌려주면 그 오류를 던진다
const fakePool = (handler) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      const index = calls.length;
      calls.push({ sql, params });
      const out = handler(sql, params, index);
      if (out instanceof Error) throw out;
      return { rowCount: out.rows ? out.rows.length : out.rowCount || 0, rows: out.rows || [] };
    },
  };
};

// ---- listComments ----

test('원댓글 목록: 한 개 더 가져오고, 마스킹은 viewer 기준이며, 개수는 숫자로 바뀐다', async () => {
  const pool = fakePool((sql) => {
    if (/FILTER/.test(sql)) return { rows: [{ total: '7', top_level_total: '3' }] };
    return {
      rows: [
        row({ id: '30', is_hidden: true, reply_count: '2' }),
        row({ id: '20', user_id: OTHER }),
        row({ id: '10' }),
      ],
    };
  });
  const out = await listComments(pool, { isbn: ISBN, limit: 2, before: null, viewerId: OTHER });

  assert.equal(pool.calls.length, 2);
  const listCall = pool.calls.find((c) => !/FILTER/.test(c.sql));
  assert.deepEqual(listCall.params, [ISBN, null, 3]); // limit + 1
  assert.match(listCall.sql, /parent_id IS NULL/);
  assert.match(listCall.sql, /ORDER BY c\.id DESC/);

  assert.equal(out.data.length, 2); // 한 개 더 가져온 것은 잘라낸다
  assert.equal(out.nextCursor, '20');
  assert.equal(out.total, 7);
  assert.equal(out.topLevelTotal, 3);
  assert.equal(out.data[0].content, HIDDEN_PLACEHOLDER); // 타인에게 숨김 댓글은 가려진다
  assert.equal(out.data[0].reply_count, 2);
  assert.equal(out.data[1].is_mine, true);
});

test('원댓글 목록: 다음 페이지가 없으면 nextCursor는 null이고 before가 파라미터로 간다', async () => {
  const pool = fakePool((sql) => (/FILTER/.test(sql) ? { rows: [{ total: '1', top_level_total: '1' }] } : { rows: [row()] }));
  const out = await listComments(pool, { isbn: ISBN, limit: 20, before: '99' });
  assert.equal(out.nextCursor, null);
  const listCall = pool.calls.find((c) => !/FILTER/.test(c.sql));
  assert.deepEqual(listCall.params, [ISBN, '99', 21]);
});

test('원댓글 목록: 비어 있으면 빈 배열과 0', async () => {
  const pool = fakePool((sql) => (/FILTER/.test(sql) ? { rows: [{ total: '0', top_level_total: '0' }] } : { rows: [] }));
  const out = await listComments(pool, { isbn: ISBN, limit: 20 });
  assert.deepEqual(out, { data: [], total: 0, topLevelTotal: 0, nextCursor: null });
});

// ---- listReplies ----

test('답글 목록: 원댓글이 없으면 not_found이고 더 조회하지 않는다', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  const out = await listReplies(pool, { id: '5', limit: 20 });
  assert.deepEqual(out, { result: 'not_found' });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /parent_id IS NULL/); // 답글 id로 조회하면 not_found
});

test('답글 목록: 오래된 순, after 커서, 개수', async () => {
  const pool = fakePool((sql, params, index) => {
    if (index === 0) return { rows: [{ '?column?': 1 }] };
    if (/COUNT/.test(sql)) return { rows: [{ total: '3' }] };
    return { rows: [row({ id: '11', parent_id: '10' }), row({ id: '12', parent_id: '10' }), row({ id: '13', parent_id: '10' })] };
  });
  const out = await listReplies(pool, { id: '10', limit: 2, after: '9', viewerId: null });
  const listCall = pool.calls.find((c) => /ORDER BY/.test(c.sql));
  assert.match(listCall.sql, /ORDER BY c\.id ASC/);
  assert.deepEqual(listCall.params, ['10', '9', 3]);
  assert.equal(out.result, 'ok');
  assert.equal(out.data.length, 2);
  assert.equal(out.total, 3);
  assert.equal(out.nextCursor, '12');
  assert.equal(out.data[0].parent_id, '10');
  assert.equal(out.data[0].reply_count, 0);
});

// ---- createComment ----

test('원댓글 작성: 작성자는 userId, 기본 스포일러 false, 응답은 본인 기준', async () => {
  const pool = fakePool(() => ({ rows: [row({ id: '1' })] }));
  const out = await createComment(pool, { userId: AUTHOR, isbn: ISBN, content: SECRET });
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [ISBN, AUTHOR, SECRET, false]);
  assert.equal(out.result, 'ok');
  assert.equal(out.data.is_mine, true);
  assert.equal(out.data.parent_id, null);
});

test('답글 작성: 부모 조건이 INSERT 문장 안에 있고 파라미터 순서가 맞다', async () => {
  const pool = fakePool(() => ({ rows: [row({ id: '2', parent_id: '1', user_id: OTHER, is_spoiler: true })] }));
  const out = await createComment(pool, {
    userId: OTHER, isbn: ISBN, content: SECRET, parentId: '1', isSpoiler: true,
  });
  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.deepEqual(params, [ISBN, OTHER, SECRET, '1', true]);
  for (const condition of ['p.parent_id IS NULL', 'p.isbn = $1', 'p.deleted_at IS NULL', 'NOT p.is_hidden']) {
    assert.ok(sql.includes(condition), condition);
  }
  assert.equal(out.result, 'ok');
  assert.equal(out.data.parent_id, '1');
  assert.equal(out.data.is_spoiler, true);
});

test('답글 작성 실패 분류: 0행이면 부모를 다시 조회해 이유를 구분한다', async () => {
  const cases = [
    ['부모 없음', [], 'parent_not_found'],
    ['부모가 삭제 표시', [{ isbn: ISBN, parent_id: null, is_hidden: false, deleted_at: '2026-11-12' }], 'parent_not_found'],
    ['답글에 답글', [{ isbn: ISBN, parent_id: '5', is_hidden: false, deleted_at: null }], 'reply_to_reply'],
    ['다른 책', [{ isbn: '9788937460999', parent_id: null, is_hidden: false, deleted_at: null }], 'isbn_mismatch'],
    ['숨김 부모', [{ isbn: ISBN, parent_id: null, is_hidden: true, deleted_at: null }], 'parent_hidden'],
    ['그 사이 상태가 바뀜(유효해 보임)', [{ isbn: ISBN, parent_id: null, is_hidden: false, deleted_at: null }], 'parent_not_found'],
  ];
  for (const [name, parentRows, expected] of cases) {
    const pool = fakePool((sql, params, index) => (index === 0 ? { rows: [] } : { rows: parentRows }));
    const out = await createComment(pool, { userId: AUTHOR, isbn: ISBN, content: 'a', parentId: '1' });
    assert.deepEqual(out, { result: expected }, name);
    assert.equal(pool.calls.length, 2, name);
    assert.deepEqual(pool.calls[1].params, ['1'], name);
  }
});

test('답글 작성 실패 분류: 우선순위는 없음·삭제 > 답글에 답글 > 다른 책 > 숨김', async () => {
  const parent = { isbn: '9788937460999', parent_id: '5', is_hidden: true, deleted_at: null };
  const pool = fakePool((sql, params, index) => (index === 0 ? { rows: [] } : { rows: [parent] }));
  const out = await createComment(pool, { userId: AUTHOR, isbn: ISBN, content: 'a', parentId: '1' });
  assert.equal(out.result, 'reply_to_reply');
});

test('답글 INSERT 오류: FK 위반과 트리거 거부는 결과로 바꾸고, 그 밖의 오류는 그대로 던진다', async () => {
  const mapped = [
    [{ code: '23503', message: 'x' }, 'parent_not_found'],
    [{ code: '23514', message: 'reply_to_reply' }, 'reply_to_reply'],
    [{ code: '23514', message: 'reply_isbn_mismatch' }, 'isbn_mismatch'],
  ];
  for (const [fields, expected] of mapped) {
    const pool = fakePool(() => Object.assign(new Error(fields.message), fields));
    const out = await createComment(pool, { userId: AUTHOR, isbn: ISBN, content: 'a', parentId: '1' });
    assert.deepEqual(out, { result: expected });
  }

  const check = Object.assign(new Error('new row violates check constraint'), { code: '23514' });
  await assert.rejects(
    createComment(fakePool(() => check), { userId: AUTHOR, isbn: ISBN, content: 'a', parentId: '1' }),
    (error) => error === check
  );
  const other = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  await assert.rejects(
    createComment(fakePool(() => other), { userId: AUTHOR, isbn: ISBN, content: 'a', parentId: '1' }),
    (error) => error === other
  );
});

// ---- setHidden ----

test('숨기기: 소유자 조건과 삭제 표시 제외가 쿼리에 있고, 본인에게는 숨김 상태와 원문이 보인다', async () => {
  const pool = fakePool(() => ({ rows: [row({ id: '10', is_hidden: true, reply_count: '1' })] }));
  const out = await setHidden(pool, { userId: AUTHOR, id: '10', isHidden: true });
  assert.deepEqual(pool.calls[0].params, ['10', AUTHOR, true]);
  assert.match(pool.calls[0].sql, /user_id = \$2::uuid/);
  assert.match(pool.calls[0].sql, /deleted_at IS NULL/);
  assert.equal(out.result, 'ok');
  assert.equal(out.data.is_hidden, true);
  assert.equal(out.data.content, SECRET);
  assert.equal(out.data.content_masked, false);
  assert.equal(out.data.reply_count, 1);
});

test('숨김 해제는 같은 함수로 isHidden=false', async () => {
  const pool = fakePool(() => ({ rows: [row({ is_hidden: false })] }));
  const out = await setHidden(pool, { userId: AUTHOR, id: '10', isHidden: false });
  assert.deepEqual(pool.calls[0].params, ['10', AUTHOR, false]);
  assert.equal(out.data.is_hidden, false);
});

test('숨기기: 남의 댓글·없는 댓글·삭제된 댓글은 0행이라 not_found', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  assert.deepEqual(await setHidden(pool, { userId: OTHER, id: '10', isHidden: true }), { result: 'not_found' });
});

// ---- deleteComment ----

test('삭제: 답글이 달린 원댓글은 marked, 그 밖은 removed', async () => {
  const marked = fakePool(() => ({ rows: [{ marked: '1', removed: '0' }] }));
  assert.deepEqual(await deleteComment(marked, { userId: AUTHOR, id: '10' }), { result: 'ok', mode: 'marked' });
  const removed = fakePool(() => ({ rows: [{ marked: '0', removed: '1' }] }));
  assert.deepEqual(await deleteComment(removed, { userId: AUTHOR, id: '10' }), { result: 'ok', mode: 'removed' });
});

test('삭제: 남의 댓글·없는 댓글·이미 삭제 표시된 댓글은 not_found, 쿼리에 소유자 조건이 있다', async () => {
  const pool = fakePool(() => ({ rows: [{ marked: '0', removed: '0' }] }));
  assert.deepEqual(await deleteComment(pool, { userId: OTHER, id: '10' }), { result: 'not_found' });
  assert.deepEqual(pool.calls[0].params, ['10', OTHER]);
  assert.match(pool.calls[0].sql, /c\.user_id = \$2::uuid/);
  assert.match(pool.calls[0].sql, /c\.deleted_at IS NULL/);
  // 삭제 표시는 내용을 비우고, 실제 삭제는 답글이 없는 경우에만
  assert.match(pool.calls[0].sql, /content = ''/);
  assert.match(pool.calls[0].sql, /NOT t\.has_replies/);
});

// ---- 로그 ----

test('서비스 함수는 console에 아무것도 출력하지 않는다 (댓글 원문 보호)', async () => {
  const originals = {};
  const written = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[method] = console[method];
    console[method] = (...args) => written.push(args.join(' '));
  }
  try {
    const okPool = fakePool((sql) => {
      if (/FILTER/.test(sql)) return { rows: [{ total: '1', top_level_total: '1' }] };
      if (/COUNT\(\*\) AS total/.test(sql)) return { rows: [{ total: '1' }] };
      if (/marked/.test(sql)) return { rows: [{ marked: '1', removed: '0' }] };
      return { rows: [row()] };
    });
    await listComments(okPool, { isbn: ISBN, limit: 20 });
    await listReplies(okPool, { id: '10', limit: 20 });
    await createComment(okPool, { userId: AUTHOR, isbn: ISBN, content: SECRET });
    await createComment(okPool, { userId: AUTHOR, isbn: ISBN, content: SECRET, parentId: '10' });
    await setHidden(okPool, { userId: AUTHOR, id: '10', isHidden: true });
    await deleteComment(okPool, { userId: AUTHOR, id: '10' });
    const failing = fakePool(() => Object.assign(new Error(SECRET), { code: '23503' }));
    await createComment(failing, { userId: AUTHOR, isbn: ISBN, content: SECRET, parentId: '10' });
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }
  assert.deepEqual(written, []);
});
