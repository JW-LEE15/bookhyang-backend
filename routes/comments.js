// routes/comments.js: 책별 댓글 API (책은 ISBN13으로 구분)
// 조회(GET)는 공개, 작성(POST)과 삭제(DELETE)는 로그인 필요. 그래서 router.use가 아니라 라우트별로 requireAuth를 붙인다.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const {
  parseBigintId,
  validateCreateComment,
  validateListQuery,
} = require('../validators/commentValidator');

const NOT_FOUND_MESSAGE = '댓글을 찾을 수 없습니다.';

// 응답에 쓰는 컬럼. id는 bigint라 pg가 문자열로 돌려준다 (그대로 문자열로 응답)
const COMMENT_COLUMNS = 'c.id, c.isbn, c.user_id, c.content, c.created_at, u.nickname';

// 1. 책별 댓글 목록 (GET /api/comments?isbn=&limit=&before=) - 최신순, 인증 불필요
router.get('/', async (req, res) => {
  try {
    const validation = validateListQuery(req.query);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    const { isbn, limit, before } = validation.value;

    // 다음 페이지가 있는지 알기 위해 1개 더 가져온다
    const listQuery = `
      SELECT ${COMMENT_COLUMNS}
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.isbn = $1 AND ($2::bigint IS NULL OR c.id < $2::bigint)
      ORDER BY c.id DESC
      LIMIT $3
    `;
    const countQuery = 'SELECT COUNT(*) AS total FROM comments WHERE isbn = $1';

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, [isbn, before, limit + 1]),
      pool.query(countQuery, [isbn]),
    ]);

    const hasMore = listResult.rows.length > limit;
    const rows = hasMore ? listResult.rows.slice(0, limit) : listResult.rows;

    return res.status(200).json({
      success: true,
      data: rows,
      total: Number(countResult.rows[0].total),
      nextCursor: hasMore ? rows[rows.length - 1].id : null,
    });
  } catch (error) {
    console.error('댓글 목록 조회 실패:', error);
    return res.status(500).json({
      success: false,
      message: '댓글 목록 조회 중 오류가 발생했습니다.',
    });
  }
});

// 2. 댓글 작성 (POST /api/comments) - 작성자는 토큰의 req.userId만 쓴다 (body의 user_id는 무시)
router.post('/', requireAuth, async (req, res) => {
  try {
    const validation = validateCreateComment(req.body);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    const { isbn, content } = validation.value;

    const insertQuery = `
      WITH inserted AS (
        INSERT INTO comments (isbn, user_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, isbn, user_id, content, created_at
      )
      SELECT c.id, c.isbn, c.user_id, c.content, c.created_at, u.nickname
      FROM inserted c
      JOIN users u ON u.id = c.user_id
    `;
    const result = await pool.query(insertQuery, [isbn, req.userId, content]);

    return res.status(201).json({
      success: true,
      message: '댓글이 등록되었습니다.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('댓글 작성 실패:', error);
    return res.status(500).json({
      success: false,
      message: '댓글 작성 중 오류가 발생했습니다.',
    });
  }
});

// 3. 댓글 삭제 (DELETE /api/comments/:id) - 본인 댓글만. 남의 댓글·없는 댓글·잘못된 id는 똑같이 404
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseBigintId(req.params.id);
    if (id === null) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const result = await pool.query(
      'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    return res.status(200).json({
      success: true,
      message: '댓글이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('댓글 삭제 실패:', error);
    return res.status(500).json({
      success: false,
      message: '댓글 삭제 중 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
