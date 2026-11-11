// test/geminiProvider.test.js: Gemini 설정 해석, 요청 본문, 응답 해석, 오류 판정 (순수 함수 테스트, 네트워크 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAiConfig,
  buildRequestBody,
  extractText,
  isFallbackStatus,
  isSuccessStatus,
  failureFromStatus,
} = require('../services/ai/geminiProvider');

const FULL_ENV = { GEMINI_API_KEY: 'key-for-test', AI_MODEL: 'model-a', AI_FALLBACK_MODEL: 'model-b' };

test('키와 AI_MODEL이 있으면 configured', () => {
  assert.equal(resolveAiConfig(FULL_ENV).configured, true);
  assert.equal(resolveAiConfig({ AI_MODEL: 'model-a' }).configured, false);
  assert.equal(resolveAiConfig({ GEMINI_API_KEY: 'key-for-test' }).configured, false);
  assert.equal(resolveAiConfig({}).configured, false);
  assert.equal(resolveAiConfig({ GEMINI_API_KEY: '  ', AI_MODEL: 'model-a' }).configured, false);
});

test('모델 이름 형식이 이상하면 쓰지 않는다', () => {
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_MODEL: 'a/b?x=1' }).configured, false);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_FALLBACK_MODEL: 'a b' }).fallbackModel, '');
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_FALLBACK_MODEL: '' }).fallbackModel, '');
  assert.equal(resolveAiConfig(FULL_ENV).fallbackModel, 'model-b');
});

test('thinkingLevel: 설정 안 하면 minimal, 비우면 null, 허용값 밖이면 minimal', () => {
  assert.equal(resolveAiConfig(FULL_ENV).thinkingLevel, 'minimal');
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_THINKING_LEVEL: '' }).thinkingLevel, null);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_THINKING_LEVEL: '  ' }).thinkingLevel, null);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_THINKING_LEVEL: 'LOW' }).thinkingLevel, 'low');
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_THINKING_LEVEL: 'high' }).thinkingLevel, 'high');
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_THINKING_LEVEL: 'extreme' }).thinkingLevel, 'minimal');
});

test('AI_TIMEOUT_MS: 양의 정수면 그 값, 아니면 20000', () => {
  assert.equal(resolveAiConfig(FULL_ENV).totalTimeoutMs, 20000);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_TIMEOUT_MS: '15000' }).totalTimeoutMs, 15000);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_TIMEOUT_MS: 'abc' }).totalTimeoutMs, 20000);
  assert.equal(resolveAiConfig({ ...FULL_ENV, AI_TIMEOUT_MS: '0' }).totalTimeoutMs, 20000);
});

const BODY_INPUT = {
  systemInstruction: '시스템',
  userText: '사용자',
  responseJsonSchema: { type: 'object' },
  maxOutputTokens: 1024,
};

test('요청 본문: J2 방식과 generationConfig.thinkingConfig.thinkingLevel', () => {
  const body = buildRequestBody({ ...BODY_INPUT, thinkingLevel: 'minimal' });
  assert.deepEqual(body, {
    systemInstruction: { parts: [{ text: '시스템' }] },
    contents: [{ role: 'user', parts: [{ text: '사용자' }] }],
    generationConfig: {
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  });
});

test('요청 본문: thinkingLevel이 null이면 thinkingConfig를 보내지 않고, thinkingBudget과 최상위 thinkingConfig는 없다', () => {
  const body = buildRequestBody({ ...BODY_INPUT, thinkingLevel: null });
  assert.equal('thinkingConfig' in body.generationConfig, false);
  assert.equal('thinkingConfig' in body, false);
  const withLevel = buildRequestBody({ ...BODY_INPUT, thinkingLevel: 'low' });
  assert.equal('thinkingBudget' in withLevel.generationConfig.thinkingConfig, false);
  assert.equal('thinkingConfig' in withLevel, false);
  assert.equal('responseSchema' in withLevel.generationConfig, false);
});

// finishReason을 생략하면 'STOP'. 값이 없는 경우를 시험하려면 null을 넘긴다.
const successJson = (parts, finishReason = 'STOP') => ({
  candidates: [{ content: { parts }, ...(finishReason === null ? {} : { finishReason }) }],
});

test('응답 해석: thought가 아닌 part의 text를 이어 붙이고 thoughtSignature는 무시한다', () => {
  const text = extractText(
    successJson([
      { text: '생각 요약', thought: true },
      { text: '{"picks":', thoughtSignature: 'sig' },
      { text: '[]}', thought: false },
    ])
  );
  assert.equal(text, '{"picks":[]}');
});

test('응답 해석: finishReason이 STOP이 아니면 AI_BAD_OUTPUT', () => {
  for (const reason of ['MAX_TOKENS', 'SAFETY', null]) {
    assert.throws(
      () => extractText(successJson([{ text: '{}' }], reason)),
      (error) => error.code === 'AI_BAD_OUTPUT' && error.status === 502,
      `finishReason: ${reason}`
    );
  }
});

test('응답 해석: 후보가 없거나 텍스트가 비면 AI_BAD_OUTPUT', () => {
  for (const json of [null, {}, { candidates: [] }, successJson([]), successJson([{ text: '   ' }]), successJson([{ text: 'x', thought: true }])]) {
    assert.throws(() => extractText(json), (error) => error.code === 'AI_BAD_OUTPUT');
  }
});

test('상태 코드 판정: 404, 503, 429만 대체 모델 대상', () => {
  for (const status of [404, 503, 429]) assert.equal(isFallbackStatus(status), true);
  for (const status of [400, 401, 403, 500, 502, 504]) assert.equal(isFallbackStatus(status), false);
  assert.equal(isSuccessStatus(200), true);
  assert.equal(isSuccessStatus(429), false);
});

test('최종 실패 매핑: 429는 AI_BUSY, 그 밖은 AI_UNAVAILABLE', () => {
  assert.equal(failureFromStatus(429).code, 'AI_BUSY');
  assert.equal(failureFromStatus(429).status, 429);
  for (const status of [404, 503, 400, 500]) {
    const error = failureFromStatus(status);
    assert.equal(error.code, 'AI_UNAVAILABLE');
    assert.equal(error.status, 503);
  }
});
