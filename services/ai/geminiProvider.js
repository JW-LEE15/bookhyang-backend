// services/ai/geminiProvider.js: Gemini REST(generateContent) 호출과 응답 해석
// 스모크 테스트로 확정한 설정:
//   - JSON 출력은 generationConfig.responseMimeType + responseJsonSchema (J2)
//   - 생각 설정은 generationConfig.thinkingConfig.thinkingLevel (기본 minimal). thinkingBudget과 최상위 thinkingConfig는 보내지 않는다.
//   - 응답은 candidates[0].content.parts 중 thought가 true가 아닌 part의 text를 이어 붙여 읽고, thoughtSignature는 무시한다.
// 키는 x-goog-api-key 헤더로만 보낸다. 키, 프롬프트, 응답 텍스트는 로그에 남기지 않는다.
const { AiError } = require('./errors');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_THINKING_LEVEL = 'minimal';
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];
const DEFAULT_TOTAL_TIMEOUT_MS = 20000;
const MODEL_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// 기본 모델이 이 상태 코드로 실패하면 대체 모델을 한 번 시도한다
const FALLBACK_STATUSES = [404, 503, 429];

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const parsePositiveInt = (value, fallback) => {
  const text = trimmed(value);
  if (!/^[1-9][0-9]*$/.test(text)) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

// 환경변수에서 AI 설정을 읽는다.
//  - AI_THINKING_LEVEL: 설정하지 않으면 minimal, 비어 있으면 thinkingConfig를 보내지 않음(null), 허용값 밖이면 minimal
//  - AI_TIMEOUT_MS: 기본 호출과 대체 호출을 합친 전체 시간 예산(밀리초)
// configured: 키와 AI_MODEL이 모두 있고 모델 이름 형식이 맞을 때 true
const resolveAiConfig = (env = process.env) => {
  const apiKey = trimmed(env.GEMINI_API_KEY);
  const model = trimmed(env.AI_MODEL);
  const fallbackModel = trimmed(env.AI_FALLBACK_MODEL);

  let thinkingLevel = DEFAULT_THINKING_LEVEL;
  if (env.AI_THINKING_LEVEL !== undefined) {
    const level = trimmed(env.AI_THINKING_LEVEL).toLowerCase();
    if (level === '') thinkingLevel = null;
    else if (THINKING_LEVELS.includes(level)) thinkingLevel = level;
  }

  const validModel = MODEL_NAME_PATTERN.test(model);
  const validFallback = fallbackModel !== '' && MODEL_NAME_PATTERN.test(fallbackModel);

  return {
    configured: apiKey !== '' && validModel,
    apiKey,
    model,
    fallbackModel: validFallback ? fallbackModel : '',
    thinkingLevel,
    totalTimeoutMs: parsePositiveInt(env.AI_TIMEOUT_MS, DEFAULT_TOTAL_TIMEOUT_MS),
  };
};

const buildRequestBody = ({ systemInstruction, userText, responseJsonSchema, thinkingLevel, maxOutputTokens }) => ({
  systemInstruction: { parts: [{ text: systemInstruction }] },
  contents: [{ role: 'user', parts: [{ text: userText }] }],
  generationConfig: {
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseJsonSchema,
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  },
});

// 성공(200) 응답에서 모델의 답변 텍스트를 꺼낸다. 정상 종료(STOP)가 아니거나 텍스트가 없으면 AI_BAD_OUTPUT
const extractText = (json) => {
  const candidate = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (!candidate) {
    throw new AiError('AI_BAD_OUTPUT', { reason: 'no-candidate' });
  }
  if (candidate.finishReason !== 'STOP') {
    throw new AiError('AI_BAD_OUTPUT', { reason: `finish-${String(candidate.finishReason)}` });
  }

  const parts = candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');

  if (text.trim() === '') {
    throw new AiError('AI_BAD_OUTPUT', { reason: 'empty-text' });
  }
  return text;
};

const isSuccessStatus = (status) => status >= 200 && status < 300;

const isFallbackStatus = (status) => FALLBACK_STATUSES.includes(status);

// 대체 모델로도 안 될 때(또는 대체를 못 할 때) 상태 코드를 AI 오류로 바꾼다: 429는 AI_BUSY, 나머지는 AI_UNAVAILABLE
const failureFromStatus = (status) =>
  new AiError(status === 429 ? 'AI_BUSY' : 'AI_UNAVAILABLE', { reason: `http-${status}` });

const isTimeoutError = (error) => error && (error.name === 'TimeoutError' || error.name === 'AbortError');

// 모델을 한 번 호출한다. HTTP 응답을 받으면 { status, json }(성공이 아니면 json은 null)을 돌려주고,
// 시간 초과는 AI_TIMEOUT, 네트워크 오류는 AI_UNAVAILABLE, 응답 JSON 해석 실패는 AI_BAD_OUTPUT을 던진다.
const callGeminiOnce = async ({ apiKey, model, body, timeoutMs, fetchImpl = fetch }) => {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw new AiError('AI_TIMEOUT', { reason: 'timeout' });
    throw new AiError('AI_UNAVAILABLE', { reason: 'network' });
  }

  if (!isSuccessStatus(response.status)) {
    try {
      await response.body?.cancel();
    } catch {
      // 본문을 버리는 중의 오류는 무시한다
    }
    return { status: response.status, json: null };
  }

  try {
    return { status: response.status, json: await response.json() };
  } catch (error) {
    if (isTimeoutError(error)) throw new AiError('AI_TIMEOUT', { reason: 'timeout-body' });
    throw new AiError('AI_BAD_OUTPUT', { reason: 'response-json' });
  }
};

module.exports = {
  API_BASE,
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVELS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  FALLBACK_STATUSES,
  resolveAiConfig,
  buildRequestBody,
  extractText,
  isSuccessStatus,
  isFallbackStatus,
  failureFromStatus,
  callGeminiOnce,
};
