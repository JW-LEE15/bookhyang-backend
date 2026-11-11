// routes/readingRecords.js: 독서 기록 API (/api/user-books 아래에 userBooks 라우터와 함께 마운트)
// PATCH /api/user-books/:id/read-end-date - 완독일 수정 (본인 도서만, 완독 상태일 때만)
// GET·PUT·DELETE /api/user-books/:id/note - 책별 개인 메모 (아래 메모 섹션 참고)
// 실패 응답은 { success:false, message, code? }. 남의 도서·없는 도서·잘못된 id는 똑같이 404.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { parseUserBookId, validateReadEndDate, validateNoteContent } = require('../validators/readingValidator');
const { updateReadEndDate, getNote, upsertNote, deleteNote } = require('../services/readingRecords');

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

// ---- 메모: 책(user_books 행) 하나에 메모 하나, 항상 비공개 ----
// GET    /:id/note - 내 도서의 메모 조회 (메모가 없으면 data:null)
// PUT    /:id/note - 메모 작성·수정 {content}
// DELETE /:id/note - 메모 삭제 (내 도서인데 메모가 없으면 404 NOTE_NOT_FOUND)
// 남의 도서·없는 도서·잘못된 id는 어떤 경우에도 똑같은 404. 메모 내용은 로그에 남기지 않는다.
// 오류 로그에는 오류 이름과 DB 오류 코드만 남긴다. (메시지에 쿼리 값이 섞일 수 있음)
const logNoteError = (action, error) =>
  console.error(`메모 ${action} 실패 name=${error && error.name} dbCode=${error && error.code}`);

const sendNotFound = (res) => res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });

router.get('/:id/note', async (req, res) => {
  try {
    const id = parseUserBookId(req.params.id);
    if (id === null) return sendNotFound(res);

    const outcome = await getNote(pool, { userId: req.userId, id });
    if (outcome.result === 'not_found') return sendNotFound(res);

    return res.status(200).json({ success: true, data: outcome.data });
  } catch (error) {
    logNoteError('조회', error);
    return res.status(500).json({ success: false, message: '메모 조회 중 오류가 발생했습니다.' });
  }
});

router.put('/:id/note', async (req, res) => {
  try {
    const id = parseUserBookId(req.params.id);
    if (id === null) return sendNotFound(res);

    const validation = validateNoteContent(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: validation.message });
    }

    const outcome = await upsertNote(pool, {
      userId: req.userId,
      id,
      content: validation.value.content,
    });
    if (outcome.result === 'not_found') return sendNotFound(res);

    return res.status(200).json({
      success: true,
      message: '메모가 저장되었습니다.',
      data: outcome.data,
    });
  } catch (error) {
    logNoteError('저장', error);
    return res.status(500).json({ success: false, message: '메모 저장 중 오류가 발생했습니다.' });
  }
});

router.delete('/:id/note', async (req, res) => {
  try {
    const id = parseUserBookId(req.params.id);
    if (id === null) return sendNotFound(res);

    const outcome = await deleteNote(pool, { userId: req.userId, id });
    if (outcome.result === 'not_found') return sendNotFound(res);
    if (outcome.result === 'note_not_found') {
      return res.status(404).json({
        success: false,
        code: 'NOTE_NOT_FOUND',
        message: '메모를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({ success: true, message: '메모가 삭제되었습니다.' });
  } catch (error) {
    logNoteError('삭제', error);
    return res.status(500).json({ success: false, message: '메모 삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
