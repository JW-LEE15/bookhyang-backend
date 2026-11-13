// routes/ai.js: AI API
// POST /api/ai/recommend - 독서 추천 (로그인 필요)
// POST /api/ai/comment-summary - 책 댓글 AI 요약 (로그인 필요)
// 순서: 인증(401) -> 사용자별 횟수 제한(429 RATE_LIMITED) -> 입력 검증(400) -> AI 사용 가능 확인(503/429) -> 추천
// 실패는 항상 4xx/5xx 상태 코드와 { success:false, code, message }로 응답한다.
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { aiMinuteLimiter, aiDayLimiter } = require('../middleware/aiLimiters');
const { validateRecommendRequest, validateCommentSummaryRequest } = require('../validators/aiValidator');
const { AiError, INTERNAL_ERROR_BODY, toErrorBody } = require('../services/ai/errors');
const ai = require('../services/ai');
const { recommend } = require('../services/recommendation');
const { summarize } = require('../services/commentSummary');

// 로그에는 오류 코드와 고정된 짧은 사유만 남긴다. (사용자 정보, 입력, 프롬프트, 모델 응답은 남기지 않는다)
const sendError = (res, error) => {
  if (error instanceof AiError) {
    console.warn(`[AI] 실패 code=${error.code} reason=${error.reason}`);
    return res.status(error.status).json(toErrorBody(error));
  }
  // 예상 못 한 오류: 메시지에 쿼리 값이 섞일 수 있어서 이름과 DB 오류 코드만 남긴다
  console.error(`[AI] 예상 못 한 오류 name=${error && error.name} dbCode=${error && error.code}`);
  return res.status(500).json(INTERNAL_ERROR_BODY);
};

router.post('/recommend', requireAuth, aiMinuteLimiter, aiDayLimiter, async (req, res) => {
  const validation = validateRecommendRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({
      success: false,
      code: 'BAD_REQUEST',
      message: validation.message,
    });
  }

  try {
    ai.assertAvailable();
    const data = await recommend({ userId: req.userId, request: validation.value });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

// POST /api/ai/comment-summary - 책 댓글 AI 요약 (로그인 필요, 추천과 같은 사용자별 횟수 제한을 공유한다)
// body: { isbn, includeSpoilers?: boolean, refresh?: boolean }
// 댓글이 5개 미만이면 AI를 부르지 않고 422 NOT_ENOUGH_COMMENTS. 캐시 hit이면 AI를 부르지 않는다.
// DB 오류는 sendError가 이름과 DB 오류 코드만 남긴다. (댓글 원문은 로그에 남기지 않는다)
router.post('/comment-summary', requireAuth, aiMinuteLimiter, aiDayLimiter, async (req, res) => {
  const validation = validateCommentSummaryRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({
      success: false,
      code: 'BAD_REQUEST',
      message: validation.message,
    });
  }

  try {
    const data = await summarize(validation.value);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
