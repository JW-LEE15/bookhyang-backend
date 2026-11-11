// test/commentsSummary.test.js: AI 댓글 요약 입력 조회 listCommentsForSummary (가짜 pool, DB 접속 없음)
// 쿼리 문장은 실제 DB에서 실행해 보지 않았다. 여기서는 쿼리 조건 문구, 파라미터, 결과 조립, 인자 검증, 로그를 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { listCommentsForSummary, SUMMARY_MAX_COMMENTS } = require('../services/comments');

const ISBN = '9788937460777';
const SECRET = '비밀-댓글-원문-SENTINEL';

const root = (id, extra = {}) => ({
  id: String(id), content: `원댓글${id}`, created_at: `t${id}`, is_spoiler: false, ...extra,
});
const reply = (id, parentId, extra = {}) => ({
  id: String(id), parent_id: String(parentId), content: `답글${id}`, created_at: `t${id}`, is_spoiler: false, ...extra,
});

// roots 쿼리(CTE가 없는 쪽)와 replies 쿼리(WITH roots)를 구분해서 준비된 행을 돌려주는 가짜 pool
const fakePool = ({ roots = [], replies = [], error = null } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (error) throw error;
      return { rows: /WITH roots/.test(sql) ? replies : roots };
    },
  };
};
const rootsCall = (pool) => pool.calls.find((c) => !/WITH roots/.test(c.sql));
const repliesCall = (pool) => pool.calls.find((c) => /WITH roots/.test(c.sql));
const count = (text, part) => text.split(part).length - 1;

test('쿼리는 2개이고 기본값은 스포일러 제외·최대 100개', async () => {
  const pool = fakePool();
  await listCommentsForSummary(pool, { isbn: ISBN });
  assert.equal(pool.calls.length, 2);
  assert.deepEqual(rootsCall(pool).params, [ISBN, false, 100]);
  assert.deepEqual(repliesCall(pool).params, [ISBN, false, 100]);
  assert.equal(SUMMARY_MAX_COMMENTS, 100);
});

test('원댓글 쿼리: 원댓글만, 삭제·숨김 제외, 스포일러는 옵션, 최신순, limit', async () => {
  const pool = fakePool();
  await listCommentsForSummary(pool, { isbn: ISBN });
  const { sql } = rootsCall(pool);
  for (const part of [
    'c.isbn = $1',
    'c.parent_id IS NULL',
    'c.deleted_at IS NULL',
    'NOT c.is_hidden',
    '($2::boolean OR NOT c.is_spoiler)',
    'ORDER BY c.id DESC',
    'LIMIT $3',
  ]) {
    assert.ok(sql.includes(part), part);
  }
  assert.equal(/user_id|nickname/.test(sql), false); // 작성자 정보는 조회하지 않는다
});

test('답글 쿼리: 대상 원댓글에 붙은 답글만, 답글에도 같은 제외 조건, 원댓글 최신순·답글 오래된 순', async () => {
  const pool = fakePool();
  await listCommentsForSummary(pool, { isbn: ISBN });
  const { sql } = repliesCall(pool);
  assert.ok(sql.includes('JOIN roots ON roots.id = c.parent_id'));
  assert.ok(sql.includes('ORDER BY c.parent_id DESC, c.id ASC'));
  // 제외 조건이 원댓글 CTE와 답글 본문 양쪽에 있다 (부모가 제외되면 답글도 빠지고, 답글 자신의 숨김·삭제·스포일러도 걸러진다)
  assert.equal(count(sql, 'c.deleted_at IS NULL'), 2);
  assert.equal(count(sql, 'NOT c.is_hidden'), 2);
  assert.equal(count(sql, '($2::boolean OR NOT c.is_spoiler)'), 2);
  assert.ok(sql.includes('c.parent_id IS NULL')); // CTE는 원댓글만
  assert.equal(/user_id|nickname/.test(sql), false);
});

test('includeSpoilers와 limit은 파라미터로 전달된다', async () => {
  const pool = fakePool();
  const out = await listCommentsForSummary(pool, { isbn: ISBN, includeSpoilers: true, limit: 30 });
  assert.deepEqual(rootsCall(pool).params, [ISBN, true, 30]);
  assert.deepEqual(repliesCall(pool).params, [ISBN, true, 30]);
  assert.equal(out.include_spoilers, true);
});

test('결과: 오래된 스레드가 먼저, 답글은 오래된 순, include_spoilers가 붙고 작성자 정보는 없다', async () => {
  // DB가 돌려주는 모양(최신 원댓글 먼저). 행에 user_id·nickname이 섞여 와도 결과에는 나오지 않아야 한다.
  const pool = fakePool({
    roots: [root(30, { user_id: 'u3', nickname: '닉3' }), root(10, { user_id: 'u1', nickname: '닉1' })],
    replies: [reply(31, 30, { user_id: 'u2' }), reply(11, 10), reply(12, 10, { nickname: '닉' })],
  });
  const out = await listCommentsForSummary(pool, { isbn: ISBN });
  assert.deepEqual(out.threads.map((t) => t.id), ['10', '30']);
  assert.deepEqual(out.threads[0].replies.map((r) => [r.id, r.parent_id]), [['11', '10'], ['12', '10']]);
  assert.deepEqual(out.threads[1].replies.map((r) => [r.id, r.parent_id]), [['31', '30']]);
  assert.deepEqual(out.counts, { total: 5, roots: 2, replies: 3 });
  assert.equal(out.include_spoilers, false);
  assert.equal(/user_id|nickname/.test(JSON.stringify(out)), false);
  assert.deepEqual(Object.keys(out).sort(), ['counts', 'include_spoilers', 'threads']);
});

test('결과: 스포일러 포함 시 is_spoiler 표시가 그대로 전달된다', async () => {
  const pool = fakePool({
    roots: [root(2, { is_spoiler: true }), root(1)],
    replies: [reply(3, 2, { is_spoiler: true })],
  });
  const out = await listCommentsForSummary(pool, { isbn: ISBN, includeSpoilers: true });
  assert.deepEqual(out.threads.map((t) => [t.id, t.is_spoiler]), [['1', false], ['2', true]]);
  assert.equal(out.threads[1].replies[0].is_spoiler, true);
});

test('두 쿼리 사이에 부모가 바뀌어 대상에서 빠진 답글은 결과에서 버린다', async () => {
  const pool = fakePool({ roots: [root(10)], replies: [reply(11, 10), reply(21, 20)] });
  const out = await listCommentsForSummary(pool, { isbn: ISBN });
  assert.deepEqual(out.threads.map((t) => t.id), ['10']);
  assert.deepEqual(out.counts, { total: 2, roots: 1, replies: 1 });
});

test('limit을 넘는 행이 와도 원댓글+답글이 limit개를 넘지 않고 최신 스레드부터 담는다', async () => {
  const pool = fakePool({
    roots: [root(50), root(40), root(30), root(20), root(10)],
    replies: [reply(51, 50), reply(52, 50), reply(41, 40)],
  });
  const out = await listCommentsForSummary(pool, { isbn: ISBN, limit: 4 });
  assert.equal(out.counts.total, 4);
  // 최신 스레드 50(원댓글 1 + 답글 2)을 먼저 채우고, 남은 1칸에 다음 스레드 40의 원댓글만 들어간다 (40의 답글은 예산 초과로 빠진다)
  assert.deepEqual(out.threads.map((t) => t.id), ['40', '50']);
  assert.deepEqual(out.threads[0].replies, []);
  assert.deepEqual(out.threads[1].replies.map((r) => r.id), ['51', '52']);
});

test('같은 내용이면 DB 행 순서가 달라도 결과가 같다', async () => {
  const roots = [root(3), root(2), root(1)];
  const replies = [reply(5, 3), reply(4, 1), reply(6, 3)];
  const a = await listCommentsForSummary(fakePool({ roots, replies }), { isbn: ISBN });
  const b = await listCommentsForSummary(fakePool({ roots: [...roots].reverse(), replies: [...replies].reverse() }), { isbn: ISBN });
  assert.deepEqual(a, b);
});

test('댓글이 없으면 빈 결과', async () => {
  const out = await listCommentsForSummary(fakePool(), { isbn: ISBN });
  assert.deepEqual(out, {
    threads: [],
    counts: { total: 0, roots: 0, replies: 0 },
    include_spoilers: false,
  });
});

test('잘못된 인자는 쿼리 전에 예외를 던지고, 메시지에 입력값이 없다', async () => {
  const badIsbn = 'SECRET-ISBN-INPUT';
  const cases = [
    { isbn: badIsbn },
    { isbn: undefined },
    { isbn: '978893746077' },
    { isbn: ISBN, includeSpoilers: 'true' },
    { isbn: ISBN, includeSpoilers: 1 },
    { isbn: ISBN, limit: 0 },
    { isbn: ISBN, limit: 101 },
    { isbn: ISBN, limit: 1.5 },
    { isbn: ISBN, limit: '5' },
    { isbn: ISBN, limit: NaN },
  ];
  for (const args of cases) {
    const pool = fakePool();
    await assert.rejects(
      listCommentsForSummary(pool, args),
      (error) => {
        assert.equal(error.message.includes(badIsbn), false);
        assert.equal(error.message.includes('978893746077'), false);
        return true;
      },
      JSON.stringify(args)
    );
    assert.equal(pool.calls.length, 0, JSON.stringify(args));
  }
  await assert.rejects(listCommentsForSummary(fakePool()));
});

test('로그: 정상·오류 모두 console에 아무것도 출력하지 않고, DB 오류는 그대로 전달된다', async () => {
  const originals = {};
  const written = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[method] = console[method];
    console[method] = (...args) => written.push(args.join(' '));
  }
  const dbError = Object.assign(new Error(`Failing row contains (${SECRET})`), { code: '23514' });
  let thrown;
  try {
    await listCommentsForSummary(
      fakePool({ roots: [root(1, { content: SECRET })], replies: [reply(2, 1, { content: SECRET })] }),
      { isbn: ISBN, includeSpoilers: true }
    );
    try {
      await listCommentsForSummary(fakePool({ error: dbError }), { isbn: ISBN });
    } catch (error) {
      thrown = error;
    }
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
  }
  assert.equal(thrown, dbError); // 가공하지 않고 호출한 쪽에 던진다 (로그는 호출한 쪽이 describeError로 남긴다)
  assert.deepEqual(written, []);
});
