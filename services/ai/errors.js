// services/ai/errors.js: AI 기능의 오류 코드와 HTTP 응답 정의
// 실패 응답은 항상 4xx/5xx 상태 코드와 { success:false, code, message } 본문으로 준다. (200으로 실패를 알리지 않는다)
// AiError.reason은 서버 로그용 짧은 고정 문자열이다. 사용자 입력, 프롬프트, 모델 응답 텍스트는 넣지 않는다.

const ERROR_DEFINITIONS = {
  AI_BUSY: { status: 429, message: '지금 AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.' },
  AI_UNAVAILABLE: { status: 503, message: '지금은 AI 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
  AI_TIMEOUT: { status: 504, message: 'AI 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.' },
  AI_BAD_OUTPUT: { status: 502, message: 'AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.' },
  NOT_ENOUGH_CANDIDATES: { status: 422, message: '추천할 수 있는 책이 부족합니다.' },
  NOT_ENOUGH_COMMENTS: { status: 422, message: '요약할 댓글이 부족합니다. 댓글이 5개 이상 모이면 요약할 수 있습니다.' },
};

// 계약에 없는 예상 못 한 실패
const INTERNAL_ERROR_BODY = {
  success: false,
  code: 'INTERNAL_ERROR',
  message: 'AI 기능을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

class AiError extends Error {
  constructor(code, { reason } = {}) {
    const definition = ERROR_DEFINITIONS[code];
    if (!definition) {
      throw new Error(`알 수 없는 AI 오류 코드: ${code}`);
    }
    super(definition.message);
    this.name = 'AiError';
    this.code = code;
    this.status = definition.status;
    this.reason = reason || null;
  }
}

const toErrorBody = (error) => ({
  success: false,
  code: error.code,
  message: error.message,
});

module.exports = {
  ERROR_DEFINITIONS,
  INTERNAL_ERROR_BODY,
  AiError,
  toErrorBody,
};
