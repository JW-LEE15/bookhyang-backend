// routes/comments.js: 책별 댓글 API (책은 ISBN13으로 구분)
// 조회(GET)는 공개(로그인하면 "내 것", 내가 누른 하트, 본인 숨김 댓글 원문이 보인다), 작성·숨김·삭제·하트·신고는 로그인 필요.
// 그래서 router.use가 아니라 라우트별로 인증 미들웨어를 붙인다.
// DB 로직은 services/comments.js에 있다. 오류 로그에는 오류 이름과 DB 오류 코드만 남긴다. (댓글 원문 보호)
const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const optionalAuth = require('../middleware/optionalAuth');
const { describeError } = require('../services/safeError');
const commentsService = require('../services/comments');
const {
  parseBigintId,
  validateCreateComment,
  validateListQuery,
  validateRepliesQuery,
  validateHiddenBody,
  validateReportBody,
} = require('../validators/commentValidator');
const { commentLikeLimiter, commentReportLimiter } = require('../middleware/commentLimiters');

const NOT_FOUND_MESSAGE = '댓글을 찾을 수 없습니다.';

// 답글 작성이 거절된 이유 -> 응답 (기존 오류 응답 모양 {success, message}에 code만 추가)
const REPLY_FAILURES = {
  parent_not_found: { status: 404, code: 'PARENT_NOT_FOUND', message: NOT_FOUND_MESSAGE },
  reply_to_reply: { status: 400, code: 'REPLY_TO_REPLY', message: '답글에는 답글을 달 수 없습니다.' },
  isbn_mismatch: { status: 400, code: 'ISBN_MISMATCH', message: '답글은 원댓글과 같은 책에만 달 수 있습니다.' },
  parent_hidden: { status: 409, code: 'PARENT_HIDDEN', message: '숨겨진 댓글에는 답글을 달 수 없습니다.' },
};

const notFound = (res) => res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });

const serverError = (res, label, error, message) => {
  console.error(`${label}:`, describeError(error));
  return res.status(500).json({ success: false, message });
};

// 1. 책별 원댓글 목록 (GET /api/comments?isbn=&limit=&before=) - 최신순, 인증 불필요
//    data는 원댓글만이고 각 항목에 reply_count가 있다. 답글은 GET /api/comments/:id/replies
router.get('/', optionalAuth, async (req, res) => {
  try {
    const validation = validateListQuery(req.query);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    const { isbn, limit, before } = validation.value;

    const result = await commentsService.listComments(pool, {
      isbn,
      limit,
      before,
      viewerId: req.userId,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      total: result.total,
      top_level_total: result.topLevelTotal,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return serverError(res, '댓글 목록 조회 실패', error, '댓글 목록 조회 중 오류가 발생했습니다.');
  }
});

// 2. 답글 목록 (GET /api/comments/:id/replies?limit=&after=) - 오래된 순, 인증 불필요
router.get('/:id/replies', optionalAuth, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const validation = validateRepliesQuery(req.query);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    const { limit, after } = validation.value;

    const result = await commentsService.listReplies(pool, { id, limit, after, viewerId: req.userId });
    if (result.result === 'not_found') return notFound(res);

    return res.status(200).json({
      success: true,
      data: result.data,
      total: result.total,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return serverError(res, '답글 목록 조회 실패', error, '답글 목록 조회 중 오류가 발생했습니다.');
  }
});

// 3. 댓글·답글 작성 (POST /api/comments) - 작성자는 토큰의 req.userId만 쓴다 (body의 user_id는 무시)
//    body: { isbn, content, parent_id?, is_spoiler? }  (parent_id가 있으면 답글)
router.post('/', requireAuth, async (req, res) => {
  try {
    const validation = validateCreateComment(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    const { isbn, content, parentId, isSpoiler } = validation.value;

    const result = await commentsService.createComment(pool, {
      userId: req.userId,
      isbn,
      content,
      parentId,
      isSpoiler,
    });

    if (result.result !== 'ok') {
      const failure = REPLY_FAILURES[result.result];
      return res.status(failure.status).json({
        success: false,
        code: failure.code,
        message: failure.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: '댓글이 등록되었습니다.',
      data: result.data,
    });
  } catch (error) {
    return serverError(res, '댓글 작성 실패', error, '댓글 작성 중 오류가 발생했습니다.');
  }
});

// 4. 내 댓글 숨기기·숨김 해제 (PATCH /api/comments/:id/hidden) body: { is_hidden: boolean }
//    본인 댓글만. 남의 댓글·없는 댓글·삭제된 댓글·잘못된 id는 똑같이 404. 이미 같은 상태여도 200.
router.patch('/:id/hidden', requireAuth, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const validation = validateHiddenBody(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const result = await commentsService.setHidden(pool, {
      userId: req.userId,
      id,
      isHidden: validation.value.isHidden,
    });
    if (result.result === 'not_found') return notFound(res);

    return res.status(200).json({
      success: true,
      message: validation.value.isHidden ? '댓글을 숨겼습니다.' : '댓글 숨김을 해제했습니다.',
      data: result.data,
    });
  } catch (error) {
    return serverError(res, '댓글 숨김 변경 실패', error, '댓글 숨김 변경 중 오류가 발생했습니다.');
  }
});

// 5. 댓글 삭제 (DELETE /api/comments/:id) - 본인 댓글만. 남의 댓글·없는 댓글·잘못된 id는 똑같이 404
//    답글이 달린 원댓글은 「삭제된 댓글입니다」로 남고, 그 밖의 댓글은 실제로 삭제된다. (응답은 같다)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const result = await commentsService.deleteComment(pool, { userId: req.userId, id });
    if (result.result === 'not_found') return notFound(res);

    return res.status(200).json({
      success: true,
      message: '댓글이 삭제되었습니다.',
    });
  } catch (error) {
    return serverError(res, '댓글 삭제 실패', error, '댓글 삭제 중 오류가 발생했습니다.');
  }
});

// 6. 하트 누르기 (PUT /api/comments/:id/like) - 멱등. 인증 -> 횟수 제한 순서
//    없는·삭제된 댓글, 타인의 숨김 댓글, 잘못된 id는 404. 본인 댓글은 400 LIKE_OWN_COMMENT
router.put('/:id/like', requireAuth, commentLikeLimiter, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const result = await commentsService.likeComment(pool, { userId: req.userId, id });
    if (result.result === 'not_found') return notFound(res);
    if (result.result === 'own_comment') {
      return res.status(400).json({
        success: false,
        code: 'LIKE_OWN_COMMENT',
        message: '본인 댓글에는 하트를 누를 수 없습니다.',
      });
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return serverError(res, '댓글 하트 실패', error, '댓글 하트 처리 중 오류가 발생했습니다.');
  }
});

// 7. 하트 취소 (DELETE /api/comments/:id/like) - 멱등. 본인·숨김 댓글에도 허용
//    없는·삭제된 댓글과 잘못된 id만 404
router.delete('/:id/like', requireAuth, commentLikeLimiter, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const result = await commentsService.unlikeComment(pool, { userId: req.userId, id });
    if (result.result === 'not_found') return notFound(res);

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return serverError(res, '댓글 하트 취소 실패', error, '댓글 하트 취소 중 오류가 발생했습니다.');
  }
});

// 8. 댓글 신고 (POST /api/comments/:id/report) body: { reason, detail? } - 저장만 한다. (자동 숨김·삭제 없음)
//    본인 댓글 400 REPORT_OWN_COMMENT, 중복 409 ALREADY_REPORTED, 없는·삭제된 댓글 404
//    응답에 신고자 정보를 넣지 않고, detail과 신고자는 로그에 남기지 않는다.
router.post('/:id/report', requireAuth, commentReportLimiter, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) return notFound(res);

    const validation = validateReportBody(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const result = await commentsService.reportComment(pool, {
      userId: req.userId,
      id,
      reason: validation.value.reason,
      detail: validation.value.detail,
    });
    if (result.result === 'not_found') return notFound(res);
    if (result.result === 'own_comment') {
      return res.status(400).json({
        success: false,
        code: 'REPORT_OWN_COMMENT',
        message: '본인 댓글은 신고할 수 없습니다.',
      });
    }
    if (result.result === 'already_reported') {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_REPORTED',
        message: '이미 신고한 댓글입니다.',
      });
    }

    return res.status(201).json({ success: true, message: '신고가 접수되었습니다.' });
  } catch (error) {
    return serverError(res, '댓글 신고 실패', error, '댓글 신고 중 오류가 발생했습니다.');
  }
});

module.exports = router;
