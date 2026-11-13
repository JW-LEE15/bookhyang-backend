// test/readingReportService.test.js: generateReport 오케스트레이션 (가짜 store·records·AI, DB·네트워크·.env 사용 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReport, periodRange, PROMPT_VERSION } = require('../services/readingReport');
const realStore = require('../services/readingReportStore');
const { AiError } = require('../services/ai/errors');

const USER = '00000000-0000-4000-8000-0000000000aa';
const NOTE_SECRET = '비밀-메모-원문-SENTINEL';
const TITLE_SECRET = '비밀-책-제목-SENTINEL';
const NOW = new Date('2026-11-14T03:00:00Z'); // 한국 2026-11-14

const GOOD_TEXT = JSON.stringify({
  interest_topics: [{ text: '고독과 소외를 다룬 책을 읽었습니다.', evidence_ids: ['b1', 'b2'] }],
  repeated_thoughts: [{ text: '타인과의 거리에 대한 생각이 반복됩니다.', evidence_ids: ['n1', 'n2'] }],
  reflection_questions: [{ text: '나는 언제 가장 나답다고 느꼈나요?', evidence_ids: ['n1'] }],
  next_reading: [{ text: '관계와 고립을 다룬 작품을 읽어 보세요.', evidence_ids: ['b1'] }],
});

// 가짜 의존성 묶음. overrides로 일부를 바꾼다.
const makeDeps = (overrides = {}) => {
  const calls = { completedStats: [], notesCount: [], listBooks: [], listNotes: [], insert: [], generate: [], assertAvailable: 0, logs: [] };
  const state = { completedCount: 3, generateError: null, text: GOOD_TEXT, delayMs: 0, insertError: null, books: null };
  const ai = {
    assertAvailable() {
      calls.assertAvailable += 1;
      if (state.assertError) throw state.assertError;
    },
    async generateJson(prompt) {
      calls.generate.push(prompt);
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.generateError) throw state.generateError;
      return state.text;
    },
  };
  const store = {
    ...realStore,
    async getCompletedStats(pool, args) {
      calls.completedStats.push(args);
      return { completedCount: state.completedCount, byCategory: [{ category: '소설', count: 1 }, { category: null, count: state.completedCount - 1 }] };
    },
    async countNotesInPeriod(pool, args) {
      calls.notesCount.push(args);
      return 5;
    },
    async insertReport(pool, args) {
      calls.insert.push(args);
      if (state.insertError) throw state.insertError;
      return {
        id: '77', period_type: args.periodType, period_from: args.from, period_to: args.to,
        include_notes: args.includeNotes, stats: args.stats, report: args.report, created_at: NOW,
      };
    },
  };
  const records = {
    async listCompletedBooks(pool, args) {
      calls.listBooks.push(args);
      return state.books || [
        { id: 101, title: TITLE_SECRET, author: '저자 A' },
        { id: 102, title: '변신', author: '저자 B' },
        { id: 103, title: '이방인', author: '저자 C' },
      ];
    },
    async listNotes(pool, args) {
      calls.listNotes.push(args);
      return [
        { id: '9007199254740993', title: TITLE_SECRET, content: `${NOTE_SECRET} 하나` },
        { id: '9007199254740994', title: '변신', content: `${NOTE_SECRET} 둘` },
      ];
    },
  };
  const deps = {
    pool: { query: async () => assert.fail('pool을 직접 쓰지 않아야 합니다') },
    ai, store, records, now: () => NOW, log: (message) => calls.logs.push(message), inflight: new Map(),
    ...overrides,
  };
  return { deps, calls, state };
};

const params = (overrides = {}) => ({ userId: USER, period: 'this_month', includeNotes: false, ...overrides });
const rejectsWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AiError, `AiError여야 함: ${error && error.name}`);
    assert.equal(error.code, code);
    return true;
  });
};

// ---- 기간 ----

test('periodRange: 이번 달과 지난달 (한국 날짜)', () => {
  assert.deepEqual(periodRange('this_month', NOW), { month: '2026-11', from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(periodRange('last_month', NOW), { month: '2026-10', from: '2026-10-01', to: '2026-11-01' });
});

// ---- 기록 부족 ----

test('완독 1권이면 AI도 사용 가능 확인도 하지 않고 NOT_ENOUGH_RECORDS(422)', async () => {
  const { deps, calls, state } = makeDeps();
  state.completedCount = 1;
  await rejectsWith(generateReport(params(), deps), 'NOT_ENOUGH_RECORDS');
  assert.equal(calls.generate.length, 0);
  assert.equal(calls.assertAvailable, 0);
  assert.equal(calls.listBooks.length, 0);
  assert.equal(calls.listNotes.length, 0);
  assert.equal(calls.insert.length, 0);
});

test('완독 0권도 기록 부족', async () => {
  const { deps, calls, state } = makeDeps();
  state.completedCount = 0;
  await rejectsWith(generateReport(params(), deps), 'NOT_ENOUGH_RECORDS');
  assert.equal(calls.generate.length, 0);
});

test('완독이 2권이면 만든다 (경계)', async () => {
  const { deps, calls, state } = makeDeps();
  state.completedCount = 2;
  await generateReport(params(), deps);
  assert.equal(calls.generate.length, 1);
});

test('정제 후 책이 2권 미만으로 줄면 AI 없이 NOT_ENOUGH_RECORDS', async () => {
  const { deps, calls, state } = makeDeps();
  state.books = [{ id: 1, title: '변신', author: 'x' }, { id: 2, title: '\u0000  ', author: 'y' }];
  await rejectsWith(generateReport(params(), deps), 'NOT_ENOUGH_RECORDS');
  assert.equal(calls.generate.length, 0);
});

// ---- AI 사용 가능 확인 ----

test('AI를 쓸 수 없으면 입력 조회도 AI 호출도 하지 않는다', async () => {
  const { deps, calls, state } = makeDeps();
  state.assertError = new AiError('AI_UNAVAILABLE', { reason: 'not-configured' });
  await rejectsWith(generateReport(params(), deps), 'AI_UNAVAILABLE');
  assert.equal(calls.listBooks.length, 0);
  assert.equal(calls.generate.length, 0);
  assert.equal(calls.insert.length, 0);
});

// ---- 메모 동의 ----

test('includeNotes=false면 메모 조회 함수를 호출하지 않고 프롬프트에 메모가 없다', async () => {
  const { deps, calls } = makeDeps();
  const data = await generateReport(params({ includeNotes: false }), deps);
  assert.equal(calls.listNotes.length, 0);
  assert.ok(!calls.generate[0].userText.includes(NOTE_SECRET));
  assert.equal(data.include_notes, false);
  assert.equal(data.stats.ai_input.notes_sent, 0);
  assert.equal(data.stats.notes_count, 5); // 서버가 센 기간 메모 수는 동의와 상관없이 준다
  assert.deepEqual(data.report.repeated_thoughts, []); // 메모 없이는 반복된 생각이 없다
});

test('includeNotes=true면 메모를 조회해서 프롬프트에 넣고 반복된 생각이 남는다', async () => {
  const { deps, calls } = makeDeps();
  const data = await generateReport(params({ includeNotes: true }), deps);
  assert.equal(calls.listNotes.length, 1);
  assert.equal(calls.listNotes[0].limit, 30);
  assert.equal(calls.listNotes[0].userId, USER);
  assert.ok(calls.generate[0].userText.includes(NOTE_SECRET));
  assert.equal(data.include_notes, true);
  assert.equal(data.stats.ai_input.notes_sent, 2);
  assert.deepEqual(data.report.repeated_thoughts[0].evidence.note_ids, ['9007199254740993', '9007199254740994']);
});

// ---- 저장과 응답 ----

test('기간 계산, 완독 목록 limit, 저장 인자, 응답 모양', async () => {
  const { deps, calls } = makeDeps();
  const data = await generateReport(params({ period: 'last_month', includeNotes: true }), deps);

  assert.deepEqual(calls.completedStats[0], { userId: USER, from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(calls.listBooks[0], { userId: USER, from: '2026-10-01', to: '2026-11-01', limit: 30 });

  assert.equal(calls.insert.length, 1);
  const saved = calls.insert[0];
  assert.equal(saved.userId, USER);
  assert.equal(saved.periodType, 'last_month');
  assert.equal(saved.from, '2026-10-01');
  assert.equal(saved.to, '2026-11-01');
  assert.equal(saved.includeNotes, true);
  assert.equal(saved.promptVersion, PROMPT_VERSION);
  assert.deepEqual(saved.stats.by_category, [{ category: '소설', count: 1 }, { category: null, count: 2 }]);
  assert.equal(saved.stats.completed_count, 3);

  assert.equal(data.id, '77');
  assert.equal(data.generated_at, NOW.toISOString());
  assert.deepEqual(data.period, { type: 'last_month', label: '2026-10', from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(data.report.interest_topics[0].evidence, { book_ids: ['101', '102'], note_ids: [] });
  assert.equal(data.report.next_reading[0].text, '관계와 고립을 다룬 작품을 읽어 보세요.');
});

test('저장되는 근거는 id뿐이고 메모 원문과 책 제목은 저장되지 않는다', async () => {
  const { deps, calls } = makeDeps();
  await generateReport(params({ includeNotes: true }), deps);
  const stored = JSON.stringify(calls.insert[0]);
  assert.ok(!stored.includes(NOTE_SECRET));
  assert.ok(!stored.includes(TITLE_SECRET));
});

test('프롬프트에 사용자 id와 실제 id가 없다', async () => {
  const { deps, calls } = makeDeps();
  await generateReport(params({ includeNotes: true }), deps);
  const { userText } = calls.generate[0];
  assert.ok(!userText.includes(USER));
  assert.ok(!userText.includes('9007199254740993'));
  assert.ok(!userText.includes('"id":"101"'));
});

// ---- 실패는 저장하지 않는다 ----

test('AI 오류(AI_TIMEOUT)면 저장하지 않고, 다음 요청이 다시 시도한다', async () => {
  const { deps, calls, state } = makeDeps();
  state.generateError = new AiError('AI_TIMEOUT', { reason: 'timeout' });
  await rejectsWith(generateReport(params(), deps), 'AI_TIMEOUT');
  assert.equal(calls.insert.length, 0);
  assert.equal(deps.inflight.size, 0);

  state.generateError = null;
  await generateReport(params(), deps);
  assert.equal(calls.generate.length, 2);
  assert.equal(calls.insert.length, 1);
});

test('AI 출력이 검증을 통과하지 못하면 AI_BAD_OUTPUT이고 저장하지 않는다', async () => {
  for (const text of ['JSON 아님', JSON.stringify({ interest_topics: [], repeated_thoughts: [], reflection_questions: [], next_reading: [] })]) {
    const { deps, calls, state } = makeDeps();
    state.text = text;
    await rejectsWith(generateReport(params(), deps), 'AI_BAD_OUTPUT');
    assert.equal(calls.insert.length, 0);
  }
});

test('저장(DB) 실패는 그대로 던지고 진행 중 표시를 지운다', async () => {
  const { deps, state } = makeDeps();
  state.insertError = Object.assign(new Error('db down'), { code: '08006' });
  await assert.rejects(generateReport(params(), deps), (error) => error.code === '08006');
  assert.equal(deps.inflight.size, 0);
});

// ---- 동시 요청 ----

test('같은 사용자의 같은 요청이 동시에 오면 AI 호출과 저장은 한 번이고 같은 결과를 받는다', async () => {
  const { deps, calls, state } = makeDeps();
  state.delayMs = 20;
  const [a, b] = await Promise.all([generateReport(params(), deps), generateReport(params(), deps)]);
  assert.equal(calls.generate.length, 1);
  assert.equal(calls.insert.length, 1);
  assert.equal(a.id, b.id);
  assert.equal(deps.inflight.size, 0);
});

test('끝난 뒤의 같은 요청은 캐시 없이 새로 만든다', async () => {
  const { deps, calls } = makeDeps();
  await generateReport(params(), deps);
  await generateReport(params(), deps);
  assert.equal(calls.generate.length, 2);
  assert.equal(calls.insert.length, 2);
});

test('기간, includeNotes, 사용자가 다르면 동시에 와도 따로 만든다', async () => {
  const { deps, calls, state } = makeDeps();
  state.delayMs = 10;
  await Promise.all([
    generateReport(params(), deps),
    generateReport(params({ period: 'last_month' }), deps),
    generateReport(params({ includeNotes: true }), deps),
    generateReport(params({ userId: '00000000-0000-4000-8000-0000000000bb' }), deps),
  ]);
  assert.equal(calls.generate.length, 4);
  assert.equal(calls.insert.length, 4);
});

// ---- 로그 ----

test('로그에는 개수와 시간만 있고 메모 원문, 책 제목, 사용자 id는 없다', async () => {
  const { deps, calls } = makeDeps();
  await generateReport(params({ includeNotes: true }), deps);
  assert.equal(calls.logs.length, 1);
  assert.match(calls.logs[0], /completed=3 booksSent=3 notesSent=2 items=4 elapsedMs=\d+/);
  const logged = calls.logs.join('\n');
  assert.ok(!logged.includes(NOTE_SECRET) && !logged.includes(TITLE_SECRET) && !logged.includes(USER));
});
