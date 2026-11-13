// test/commentSummaryService.test.js: summarize 오케스트레이션 (가짜 댓글 조회·가짜 AI·가짜 시계, DB·네트워크·.env 사용 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, CACHE_TTL_MS, CACHE_MAX_ENTRIES } = require('../services/commentSummary');
const { createTtlCache } = require('../services/ai/cache');
const { AiError } = require('../services/ai/errors');

const ISBN = '9790000000019';
const SECRET = '비밀-댓글-원문-SENTINEL';

// listCommentsForSummary 결과 모양. n개의 원댓글(id 101, 102, ...)
const makeInput = (n, { startId = 101, content = (i) => `댓글 ${i} 번 내용입니다` } = {}) => ({
  threads: Array.from({ length: n }, (_, i) => ({
    id: String(startId + i), content: content(i + 1), created_at: `t${i}`, is_spoiler: false, replies: [],
  })),
  counts: { total: n, roots: n, replies: 0 },
  include_spoilers: false,
});

const MODEL_TEXT = JSON.stringify({
  main_opinions: [{ text: '여러 독자가 비슷한 의견을 냈습니다.', evidence_ids: ['c1', 'c2'] }],
  differing_opinions: [],
  reader_questions: [{ text: '다음 책을 묻는 질문이 있습니다.', evidence_ids: ['c5'] }],
});

// 시계는 직접 움직인다 (캐시 TTL과 generatedAt 확인용)
const makeEnv = ({ input = makeInput(6), modelText = MODEL_TEXT } = {}) => {
  let time = Date.parse('2026-11-13T00:00:00Z');
  const logs = [];
  const env = {
    loads: [],
    generated: [],
    assertCalls: 0,
    assertError: null,
    generateError: null,
    input,
    modelText,
    logs,
    advance(ms) { time += ms; },
  };
  env.deps = {
    pool: { unused: true },
    cache: createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES, now: () => time }),
    now: () => new Date(time),
    log: (message) => logs.push(message),
    loadComments: async (pool, args) => {
      env.loads.push(args);
      return env.input;
    },
    ai: {
      assertAvailable() {
        env.assertCalls += 1;
        if (env.assertError) throw env.assertError;
      },
      async generateJson(prompt) {
        env.generated.push(prompt);
        if (env.generateError) throw env.generateError;
        return env.modelText;
      },
    },
  };
  return env;
};

const run = (env, args = {}) => summarize({ isbn: ISBN, ...args }, env.deps);

// ---- 5개 미만 ----

test('댓글이 5개 미만이면 AI를 부르지 않고 NOT_ENOUGH_COMMENTS(422)', async () => {
  const env = makeEnv({ input: makeInput(4) });
  await assert.rejects(run(env), (e) => e instanceof AiError && e.code === 'NOT_ENOUGH_COMMENTS' && e.status === 422);
  assert.equal(env.generated.length, 0);
  assert.equal(env.assertCalls, 0);
});

test('원댓글과 답글을 합쳐서 5개면 요약한다', async () => {
  const input = makeInput(3);
  input.threads[0].replies = [{ id: '201', parent_id: '101', content: '답글 하나', created_at: 't', is_spoiler: false }];
  input.threads[1].replies = [{ id: '202', parent_id: '102', content: '답글 둘', created_at: 't', is_spoiler: false }];
  const env = makeEnv({ input });
  const data = await run(env);
  assert.deepEqual(data.counts, { total: 5, roots: 3, replies: 2 });
});

test('댓글이 없어도 NOT_ENOUGH_COMMENTS', async () => {
  const env = makeEnv({ input: { threads: [], counts: { total: 0, roots: 0, replies: 0 }, include_spoilers: false } });
  await assert.rejects(run(env), (e) => e.code === 'NOT_ENOUGH_COMMENTS');
});

// ---- 생성 ----

test('정상 생성: 응답 모양, cached:false, 댓글 조회 인자, AI 한 번', async () => {
  const env = makeEnv();
  const data = await run(env, { includeSpoilers: true });
  assert.deepEqual(env.loads, [{ isbn: ISBN, includeSpoilers: true }]);
  assert.equal(env.generated.length, 1);
  assert.equal(env.assertCalls, 1);
  assert.equal(data.cached, false);
  assert.equal(data.isbn, ISBN);
  assert.equal(data.includeSpoilers, true);
  assert.equal(data.generatedAt, '2026-11-13T00:00:00.000Z');
  assert.deepEqual(data.counts, { total: 6, roots: 6, replies: 0 });
  assert.deepEqual(data.summary.main_opinions[0].evidence_ids, ['101', '102']);
  assert.deepEqual(data.summary.reader_questions[0].evidence_ids, ['105']);
  assert.deepEqual(data.comments.map((c) => c.id), ['101', '102', '105']);
});

test('AI에 보내는 프롬프트에는 실제 댓글 id가 없다', async () => {
  const env = makeEnv();
  await run(env);
  const sent = JSON.stringify(env.generated[0]);
  assert.ok(!sent.includes('"101"') && !sent.includes('101'));
  assert.ok(sent.includes('c1'));
});

// ---- 캐시 ----

test('같은 입력의 두 번째 요청은 AI를 부르지 않고 cached:true, generatedAt은 처음 시각', async () => {
  const env = makeEnv();
  const first = await run(env);
  env.advance(5 * 60 * 1000);
  const second = await run(env);
  assert.equal(env.generated.length, 1);
  assert.equal(second.cached, true);
  assert.equal(second.generatedAt, first.generatedAt);
  assert.deepEqual(second.summary, first.summary);
  assert.deepEqual(second.comments, first.comments);
});

test('캐시 hit이면 AI 사용 가능 확인도 하지 않아서 AI가 막힌 상태에서도 요약을 준다', async () => {
  const env = makeEnv();
  await run(env);
  env.assertError = new AiError('AI_BUSY', { reason: 'server-daily-limit' });
  const data = await run(env);
  assert.equal(data.cached, true);
  assert.equal(env.assertCalls, 1);
  // 캐시에 없는 입력은 막힌다
  env.input = makeInput(7);
  await assert.rejects(run(env), (e) => e.code === 'AI_BUSY');
  assert.equal(env.generated.length, 1);
});

test('AI가 설정되지 않았으면(AI_UNAVAILABLE) 캐시 miss는 오류이고 캐시는 비어 있다', async () => {
  const env = makeEnv();
  env.assertError = new AiError('AI_UNAVAILABLE', { reason: 'not-configured' });
  await assert.rejects(run(env), (e) => e.code === 'AI_UNAVAILABLE');
  assert.equal(env.deps.cache.size(), 0);
});

test('TTL(20분)이 지나면 다시 만든다', async () => {
  assert.equal(CACHE_TTL_MS, 20 * 60 * 1000);
  const env = makeEnv();
  await run(env);
  env.advance(CACHE_TTL_MS - 1000);
  assert.equal((await run(env)).cached, true);
  env.advance(CACHE_TTL_MS); // 마지막 저장은 처음 시각이라 이제 만료
  const again = await run(env);
  assert.equal(again.cached, false);
  assert.equal(env.generated.length, 2);
});

test('refresh:true는 캐시를 건너뛰고 새로 만들어 캐시를 덮어쓴다', async () => {
  const env = makeEnv();
  const first = await run(env);
  env.advance(60 * 1000);
  const refreshed = await run(env, { refresh: true });
  assert.equal(refreshed.cached, false);
  assert.notEqual(refreshed.generatedAt, first.generatedAt);
  assert.equal(env.generated.length, 2);
  const after = await run(env);
  assert.equal(after.cached, true);
  assert.equal(after.generatedAt, refreshed.generatedAt);
  assert.equal(env.generated.length, 2);
});

test('includeSpoilers가 다르면 캐시를 따로 쓴다', async () => {
  const env = makeEnv();
  await run(env, { includeSpoilers: false });
  const on = await run(env, { includeSpoilers: true });
  assert.equal(on.cached, false);
  assert.equal(env.generated.length, 2);
  assert.equal((await run(env, { includeSpoilers: true })).cached, true);
  assert.equal((await run(env, { includeSpoilers: false })).cached, true);
  assert.equal(env.generated.length, 2);
});

test('isbn이 다르면 캐시를 따로 쓴다', async () => {
  const env = makeEnv();
  await run(env);
  const other = await summarize({ isbn: '9790000000026' }, env.deps);
  assert.equal(other.cached, false);
  assert.equal(env.generated.length, 2);
});

test('새 댓글이 생기거나 댓글이 숨김·삭제로 빠지면 지문이 바뀌어 새로 만든다', async () => {
  const env = makeEnv();
  await run(env);
  env.input = makeInput(7); // 새 댓글
  assert.equal((await run(env)).cached, false);
  env.input = makeInput(6, { startId: 102 }); // 같은 개수지만 id가 다르다 (하나 빠지고 하나 생김)
  assert.equal((await run(env)).cached, false);
  assert.equal(env.generated.length, 3);
});

test('캐시 hit이어도 counts와 근거 색인은 이번 요청의 입력으로 만든다', async () => {
  const env = makeEnv();
  await run(env);
  env.input = makeInput(6, { content: (i) => `다른 내용 ${i}` }); // 같은 id, 다른 내용 (지문은 같다)
  const data = await run(env);
  assert.equal(data.cached, true);
  assert.equal(data.comments[0].preview, '다른 내용 1');
});

// ---- 동시 요청 ----

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('같은 입력이 동시에 오면 AI 호출은 한 번이고 나머지는 cached:true', async () => {
  const env = makeEnv();
  const gate = deferred();
  env.deps.ai.generateJson = async (prompt) => {
    env.generated.push(prompt);
    await gate.promise;
    return MODEL_TEXT;
  };
  const first = run(env);
  const second = run(env);
  const third = run(env);
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  const results = await Promise.all([first, second, third]);
  assert.equal(env.generated.length, 1);
  assert.deepEqual(results.map((r) => r.cached), [false, true, true]);
  assert.equal(new Set(results.map((r) => r.generatedAt)).size, 1);
});

test('동시 요청 중 생성이 실패하면 합류한 요청도 같은 오류를 받고, 실패는 캐시되지 않아 다음에 다시 시도한다', async () => {
  const env = makeEnv();
  const gate = deferred();
  env.deps.ai.generateJson = async (prompt) => {
    env.generated.push(prompt);
    await gate.promise;
    throw new AiError('AI_TIMEOUT', { reason: 'timeout' });
  };
  const first = run(env);
  const second = run(env);
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  const settled = await Promise.allSettled([first, second]);
  assert.deepEqual(settled.map((s) => s.reason && s.reason.code), ['AI_TIMEOUT', 'AI_TIMEOUT']);
  assert.equal(env.generated.length, 1);
  assert.equal(env.deps.cache.size(), 0);

  env.deps.ai.generateJson = async (prompt) => {
    env.generated.push(prompt);
    return MODEL_TEXT;
  };
  const retry = await run(env);
  assert.equal(retry.cached, false);
  assert.equal(env.generated.length, 2);
});

test('refresh가 진행 중인 요청을 덮어쓰면 먼저 끝난 오래된 요청이 캐시를 되돌리지 않는다', async () => {
  const env = makeEnv();
  const slow = deferred();
  let calls = 0;
  env.deps.ai.generateJson = async () => {
    calls += 1;
    if (calls === 1) {
      await slow.promise;
      return MODEL_TEXT;
    }
    return JSON.stringify({
      main_opinions: [{ text: '새 요약입니다.', evidence_ids: ['c3'] }], differing_opinions: [], reader_questions: [],
    });
  };
  const old = run(env);
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await run(env, { refresh: true });
  slow.resolve();
  await old;
  const cached = await run(env);
  assert.equal(cached.cached, true);
  assert.equal(cached.summary.main_opinions[0].text, fresh.summary.main_opinions[0].text);
});

// ---- 실패는 캐시하지 않는다 ----

test('AI 오류(AI_BUSY, AI_UNAVAILABLE, AI_TIMEOUT)는 그대로 던지고 캐시하지 않는다', async () => {
  for (const code of ['AI_BUSY', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_BAD_OUTPUT']) {
    const env = makeEnv();
    env.generateError = new AiError(code, { reason: 'test' });
    await assert.rejects(run(env), (e) => e.code === code, code);
    assert.equal(env.deps.cache.size(), 0, code);
    env.generateError = null;
    assert.equal((await run(env)).cached, false, code);
  }
});

test('모델 출력이 깨졌거나 유효한 의견이 없으면 AI_BAD_OUTPUT이고 캐시하지 않는다', async () => {
  for (const modelText of ['not json', '{}', JSON.stringify({ main_opinions: [{ text: 'x', evidence_ids: ['c99'] }], differing_opinions: [], reader_questions: [] })]) {
    const env = makeEnv({ modelText });
    await assert.rejects(run(env), (e) => e.code === 'AI_BAD_OUTPUT');
    assert.equal(env.deps.cache.size(), 0);
  }
});

test('주요 의견이 비어도 질문이나 의견 차이가 있으면 성공하고, 캐시된다', async () => {
  const modelText = JSON.stringify({
    main_opinions: [],
    differing_opinions: [],
    reader_questions: [{ text: '다음 책을 묻는 질문이 있습니다.', evidence_ids: ['c5'] }],
  });
  const env = makeEnv({ modelText });
  const first = await run(env);
  assert.deepEqual(first.summary.main_opinions, []);
  assert.deepEqual(first.summary.reader_questions[0].evidence_ids, ['105']);
  assert.deepEqual(first.comments.map((c) => c.id), ['105']);
  assert.equal(first.cached, false);
  const second = await run(env);
  assert.equal(second.cached, true);
  assert.equal(env.generated.length, 1);
  assert.match(env.logs.join('\n'), /items=1/);
});

test('세 목록이 모두 비면 AI_BAD_OUTPUT(empty-summary)이고 캐시하지 않는다', async () => {
  const modelText = JSON.stringify({ main_opinions: [], differing_opinions: [], reader_questions: [] });
  const env = makeEnv({ modelText });
  await assert.rejects(run(env), (e) => e.code === 'AI_BAD_OUTPUT' && e.reason === 'empty-summary');
  assert.equal(env.deps.cache.size(), 0);
});

test('댓글 조회(DB) 오류는 그대로 던지고 AI도 캐시도 건드리지 않는다', async () => {
  const env = makeEnv();
  const dbError = Object.assign(new Error('connection'), { code: '57P01' });
  env.deps.loadComments = async () => { throw dbError; };
  await assert.rejects(run(env), (e) => e === dbError);
  assert.equal(env.generated.length, 0);
  assert.equal(env.deps.cache.size(), 0);
});

// ---- 로그 ----

test('로그에는 개수와 시간만 있고 댓글 원문·프롬프트·모델 응답·id는 없다 (기본 로그 함수 포함)', async () => {
  const captured = [];
  const originals = {};
  for (const name of ['log', 'warn', 'error', 'info']) {
    originals[name] = console[name];
    console[name] = (...args) => captured.push(args.map(String).join(' '));
  }
  try {
    const env = makeEnv({ input: makeInput(6, { content: (i) => `${SECRET} ${i}` }) });
    delete env.deps.log; // 기본 로그 함수(console.log)를 쓴다
    await run(env);
    await run(env); // 재사용 로그
    await assert.rejects(summarize({ isbn: ISBN }, { ...env.deps, loadComments: async () => makeInput(2, { content: () => SECRET }) }));
  } finally {
    Object.assign(console, originals);
  }
  const all = captured.join('\n');
  assert.ok(captured.length >= 2, '완료·재사용 로그가 있어야 한다');
  assert.ok(!all.includes(SECRET));
  assert.ok(!all.includes('여러 독자가 비슷한 의견'));
  assert.ok(!/10[1-9]/.test(all.replace(/elapsedMs=\d+/g, '')), '댓글 id가 로그에 없어야 한다');
  assert.match(all, /\[AI\] 댓글 요약 완료 comments=6 items=2 elapsedMs=\d+/);
  assert.match(all, /\[AI\] 댓글 요약 재사용 comments=6 elapsedMs=\d+/);
});
