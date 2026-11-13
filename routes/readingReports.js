// routes/readingReports.js: 저장된 AI 독서 리포트 API (/api/reading-reports)
// GET    /api/reading-reports     - 내 리포트 목록 (최신 20개, 본문 전체 포함)
// DELETE /api/reading-reports/:id - 내 리포트 삭제 (남의 리포트·없는 리포트·잘못된 id는 똑같이 404)
// 리포트 생성은 POST /api/ai/reading-report (routes/ai.js)
// 실패 응답은 { success:false, message }. 리포트 내용은 로그에 남기지 않고, 오류 로그에는 오류 이름과 DB 오류 코드만 남긴다.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { parseReportId, listReports, deleteReport, buildReportResponse } = require('../services/readingReportStore');

const NOT_FOUND_MESSAGE = '해당 리포트를 찾을 수 없습니다.';

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const rows = await listReports(pool, { userId: req.userId });
    return res.status(200).json({ success: true, data: rows.map(buildReportResponse) });
  } catch (error) {
    console.error(`리포트 목록 조회 실패 name=${error && error.name} dbCode=${error && error.code}`);
    return res.status(500).json({ success: false, message: '리포트 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseReportId(req.params.id);
    if (id === null) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const deleted = await deleteReport(pool, { userId: req.userId, id });
    if (!deleted) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }
    return res.status(200).json({ success: true, message: '리포트가 삭제되었습니다.' });
  } catch (error) {
    console.error(`리포트 삭제 실패 name=${error && error.name} dbCode=${error && error.code}`);
    return res.status(500).json({ success: false, message: '리포트 삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
