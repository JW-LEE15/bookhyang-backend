// test/aiOrchestrator.test.js: 기본 모델 -> 대체 모델 흐름 (가짜 callModel과 가짜 시계 사용, 네트워크 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithFallback, MIN_FALLBACK_BUDGET_MS } = require('../services/ai');
const { createUsageGuard } = require('../services/ai/usageGuard');
const { AiError } = require('../services/ai/errors');

const CONFIG = { model: 'primary', fallbackModel: 'secondary', totalTimeoutMs: 20000 };
const NOW = () => new Date('2026-11-11T12:00:00Z');

// 시계를 직접 움직이는 환경. calls에 호출된 모델 이름이 쌓인다.
const makeEnv = ({ responses, guard, elapsedPerCall = 0 }) => {
  let time = 1_000_000;
  const calls = [];
  const timeouts = [];
  const queue = [...responses];
  return {
    calls,
    timeouts,
    args: {
      config: CONFIG,
      guard: guard || createUsageGuard({ dailyLimit: 100, now: NOW }),
      now: () => time,
      log: () => {},
      callModel: async ({ model, timeoutMs }) => {
        calls.push(model);
        timeouts.push(timeoutMs);
        time += elapsedPerCall;
        const next = queue.shift();
        if (next instanceof AiError) throw next;
        return next;
      },
    },
  };
};

test('기본 모델이 성공하면 대체 모델은 부르지 않는다', async () => {
  const env = makeEnv({ responses: [{ status: 200, json: { ok: 1 } }] });
  const result = await runWithFallback(env.args);
  assert.deepEqual(env.calls, ['primary']);
  assert.equal(result.model, 'primary');
  assert.deepEqual(result.json, { ok: 1 });
});

test('404, 503, 429면 대체 모델을 한 번 부르고 성공하면 그 결과를 쓴다', async () => {
  for (const status of [404, 503, 429]) {
    const env = makeEnv({ responses: [{ status, json: null }, { status: 200, json: { ok: 2 } }] });
    const result = await runWithFallback(env.args);
    assert.deepEqual(env.calls, ['primary', 'secondary'], `status ${status}`);
    assert.equal(result.model, 'secondary');
  }
});

test('대체 모델도 실패하면 대체 호출은 1번뿐이고 마지막 상태로 오류를 낸다', async () => {
  const env = makeEnv({ responses: [{ status: 503, json: null }, { status: 429, json: null }, { status: 200, json: {} }] });
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_BUSY');
  assert.deepEqual(env.calls, ['primary', 'secondary']);

  const env2 = makeEnv({ responses: [{ status: 429, json: null }, { status: 503, json: null }] });
  await assert.rejects(runWithFallback(env2.args), (error) => error.code === 'AI_UNAVAILABLE');
});

test('400, 401, 500 같은 상태는 대체 없이 AI_UNAVAILABLE', async () => {
  for (const status of [400, 401, 403, 500]) {
    const env = makeEnv({ responses: [{ status, json: null }] });
    await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_UNAVAILABLE');
    assert.deepEqual(env.calls, ['primary'], `status ${status}`);
  }
});

test('대체 모델이 없으면 429는 AI_BUSY, 404와 503은 AI_UNAVAILABLE', async () => {
  const noFallback = (response) => {
    const env = makeEnv({ responses: [response] });
    env.args.config = { ...CONFIG, fallbackModel: '' };
    return env;
  };
  const busy = noFallback({ status: 429, json: null });
  await assert.rejects(runWithFallback(busy.args), (error) => error.code === 'AI_BUSY');
  assert.deepEqual(busy.calls, ['primary']);
  const gone = noFallback({ status: 404, json: null });
  await assert.rejects(runWithFallback(gone.args), (error) => error.code === 'AI_UNAVAILABLE');
});

test('대체 모델이 기본 모델과 같은 이름이면 부르지 않는다', async () => {
  const env = makeEnv({ responses: [{ status: 503, json: null }] });
  env.args.config = { ...CONFIG, fallbackModel: 'primary' };
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_UNAVAILABLE');
  assert.deepEqual(env.calls, ['primary']);
});

test('남은 시간이 3초 미만이면 대체 호출을 건너뛴다', async () => {
  assert.equal(MIN_FALLBACK_BUDGET_MS, 3000);
  // 기본 호출이 17.5초 걸려서 2.5초 남음
  const env = makeEnv({ responses: [{ status: 503, json: null }], elapsedPerCall: 17500 });
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_UNAVAILABLE');
  assert.deepEqual(env.calls, ['primary']);
});

test('남은 시간이 3초 이상이면 대체 호출을 하고, 대체 호출의 제한 시간은 남은 시간이다', async () => {
  // 기본 호출이 5초 걸려서 15초 남음
  const env = makeEnv({
    responses: [{ status: 503, json: null }, { status: 200, json: {} }],
    elapsedPerCall: 5000,
  });
  await runWithFallback(env.args);
  assert.deepEqual(env.calls, ['primary', 'secondary']);
  assert.equal(env.timeouts[0], 20000);
  assert.equal(env.timeouts[1], 15000); // 전체 20초 중 기본 호출이 5초를 썼다
});

test('시간 초과는 대체 없이 그대로 전달한다', async () => {
  const env = makeEnv({ responses: [new AiError('AI_TIMEOUT', { reason: 'timeout' })] });
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_TIMEOUT' && error.status === 504);
  assert.deepEqual(env.calls, ['primary']);
});

test('대체 호출도 서버 전체 카운터에 센다', async () => {
  const guard = createUsageGuard({ dailyLimit: 100, now: NOW });
  const env = makeEnv({ responses: [{ status: 503, json: null }, { status: 200, json: {} }], guard });
  await runWithFallback(env.args);
  assert.equal(guard.getCount(), 2);
});

test('서버 임계값에 닿으면 호출하지 않고 AI_BUSY', async () => {
  const guard = createUsageGuard({ dailyLimit: 10, now: NOW }); // 임계값 9
  for (let i = 0; i < 9; i += 1) guard.reserve();
  const env = makeEnv({ responses: [{ status: 200, json: {} }], guard });
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_BUSY' && error.status === 429);
  assert.deepEqual(env.calls, []);
});

test('기본 호출이 마지막 한 칸을 쓰면 대체 호출은 AI_BUSY가 된다', async () => {
  const guard = createUsageGuard({ dailyLimit: 10, now: NOW }); // 임계값 9
  for (let i = 0; i < 8; i += 1) guard.reserve();
  const env = makeEnv({ responses: [{ status: 503, json: null }, { status: 200, json: {} }], guard });
  await assert.rejects(runWithFallback(env.args), (error) => error.code === 'AI_BUSY');
  assert.deepEqual(env.calls, ['primary']);
});
