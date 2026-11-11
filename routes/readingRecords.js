// routes/readingRecords.js: 독서 기록 API (/api/user-books 아래에 userBooks 라우터와 함께 마운트)
// PATCH /api/user-books/:id/read-end-date - 완독일 수정 (본인 도서만, 완독 상태일 때만)
// 실패 응답은 { success:false, message, code? }. 남의 도서·없는 도서·잘못된 id는 똑같이 404.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { parseUserBookId, validateReadEndDate } = require('../validators/readingValidator');
const { updateReadEndDate } = require('../services/readingRecords');

const NOT_FOUND_MESSAGE = '해당 도서를 찾을 수 없습니다.';

router.use(requireAuth);

router.patch('/:id/read-end-date', async (req, res) => {
  try {
    const id = parseUserBookId(req.params.id);
    if (id === null) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const validation = validateReadEndDate(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: validation.message });
    }

    const outcome = await updateReadEndDate(pool, {
      userId: req.userId,
      id,
      readEndDate: validation.value.readEndDate,
    });

    if (outcome.result === 'not_found') {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }
    if (outcome.result === 'not_completed') {
      return res.status(409).json({
        success: false,
        code: 'NOT_COMPLETED',
        message: '완독 상태인 도서만 완독일을 바꿀 수 있습니다.',
      });
    }

    return res.status(200).json({
      success: true,
      message: '완독일이 수정되었습니다.',
      data: outcome.data,
    });
  } catch (error) {
    // 메시지에 쿼리 값이 섞일 수 있어서 이름과 DB 오류 코드만 남긴다
    console.error(`완독일 수정 실패 name=${error && error.name} dbCode=${error && error.code}`);
    return res.status(500).json({ success: false, message: '완독일 수정 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
