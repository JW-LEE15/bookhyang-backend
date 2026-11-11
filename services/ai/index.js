// services/ai/index.js: AI 공통 모듈의 진입점
// generateJson(): 설정 확인 -> 서버 전체 한도 예약 -> 기본 모델 호출 -> (404/503/429면) 대체 모델 한 번 -> 답변 텍스트 반환
// 로그에는 모델 이름, 상태 코드, 소요 시간, 오류 코드만 남긴다. 프롬프트와 모델 응답 텍스트는 남기지 않는다.
const { AiError } = require('./errors');
const { getSharedUsageGuard } = require('./usageGuard');
const {
  resolveAiConfig,
  buildRequestBody,
  extractText,
  isSuccessStatus,
  isFallbackStatus,
  failureFromStatus,
  callGeminiOnce,
} = require('./geminiProvider');

// 대체 모델을 시도하려면 전체 시간 예산이 이만큼은 남아 있어야 한다
const MIN_FALLBACK_BUDGET_MS = 3000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

const defaultLog = ({ model, status, elapsedMs }) => {
  console.log(`[AI] 호출 model=${model} status=${status} elapsedMs=${elapsedMs}`);
};

// 기본 모델 -> (조건이 맞으면) 대체 모델을 한 번만 호출한다.
//  - callModel({ model, timeoutMs })는 { status, json }을 돌려주거나 AiError를 던진다. (테스트에서 가짜로 바꿀 수 있다)
//  - 모든 호출은 호출 직전에 guard.reserve()로 서버 전체 카운터에 센다. 대체 호출도 포함.
//  - 시간 초과, 네트워크 오류, 한도 도달은 대체하지 않고 바로 오류로 전달한다.
const runWithFallback = async ({ config, guard, callModel, now = Date.now, log = defaultLog }) => {
  const deadline = now() + config.totalTimeoutMs;

  const attempt = async (model) => {
    if (!guard.reserve()) {
      throw new AiError('AI_BUSY', { reason: 'server-daily-limit' });
    }
    const startedAt = now();
    const result = await callModel({ model, timeoutMs: deadline - startedAt });
    log({ model, status: result.status, elapsedMs: now() - startedAt });
    return result;
  };

  const primary = await attempt(config.model);
  if (isSuccessStatus(primary.status)) {
    return { json: primary.json, model: config.model };
  }

  const canFallback =
    isFallbackStatus(primary.status) &&
    config.fallbackModel !== '' &&
    config.fallbackModel !== config.model &&
    deadline - now() >= MIN_FALLBACK_BUDGET_MS;
  if (!canFallback) {
    throw failureFromStatus(primary.status);
  }

  const fallback = await attempt(config.fallbackModel);
  if (isSuccessStatus(fallback.status)) {
    return { json: fallback.json, model: config.fallbackModel };
  }
  throw failureFromStatus(fallback.status);
};

let warnedNotConfigured = false;
const assertConfigured = (config) => {
  if (!config.configured) {
    // 원인은 서버 로그에만 남기고 (변수 이름만, 값은 남기지 않는다) 클라이언트에는 AI_UNAVAILABLE만 알린다
    if (!warnedNotConfigured) {
      console.warn('[AI] 설정이 없어 AI를 사용할 수 없습니다. GEMINI_API_KEY, AI_MODEL을 확인하세요.');
      warnedNotConfigured = true;
    }
    throw new AiError('AI_UNAVAILABLE', { reason: 'not-configured' });
  }
};

// 라우트가 DB 작업을 하기 전에 호출한다: AI를 쓸 수 없는 상태면 미리 오류를 던진다
const assertAvailable = () => {
  assertConfigured(resolveAiConfig(process.env));
  if (getSharedUsageGuard().isExhausted()) {
    throw new AiError('AI_BUSY', { reason: 'server-daily-limit' });
  }
};

// JSON 형식의 답변을 요청하고 모델이 돌려준 텍스트를 반환한다. (JSON 파싱과 내용 검증은 호출한 쪽에서 한다)
const generateJson = async ({
  systemInstruction,
  userText,
  responseJsonSchema,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
}) => {
  const config = resolveAiConfig(process.env);
  assertConfigured(config);

  const body = buildRequestBody({
    systemInstruction,
    userText,
    responseJsonSchema,
    thinkingLevel: config.thinkingLevel,
    maxOutputTokens,
  });

  const { json } = await runWithFallback({
    config,
    guard: getSharedUsageGuard(),
    callModel: ({ model, timeoutMs }) =>
      callGeminiOnce({ apiKey: config.apiKey, model, body, timeoutMs }),
  });

  return extractText(json);
};

module.exports = {
  MIN_FALLBACK_BUDGET_MS,
  runWithFallback,
  assertAvailable,
  generateJson,
};
