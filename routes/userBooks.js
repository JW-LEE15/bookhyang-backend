const express = require('express');
const router = express.Router();
const pool = require('../db');

// 1. 특정 사용자의 서재 도서 목록 조회 (GET /api/user-books/:userId)
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT id, user_id, title, author, publisher, isbn, cover_image, status, created_at
      FROM user_books
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('서재 목록 조회 실패:', error);
    return res.status(500).json({
      success: false,
      message: '서재 목록 조회 실패',
      error: error.message,
    });
  }
});

// 2. 내 서재에 도서 추가 (POST /api/user-books) - 중복 체크 및 데이터 파싱 포함
router.post('/', async (req, res) => {
  try {
    const { userId, bookInfo, status } = req.body;

    if (!userId || !bookInfo) {
      return res.status(400).json({
        success: false,
        message: '유저 ID와 도서 정보는 필수입니다.',
      });
    }

    // 1) 제목 파싱
    const title = bookInfo.title || '제목 없음';

    // 2) 저자 파싱 (배열인 경우 문자열로 병합하여 DB 에러 방지)
    let parsedAuthor = '저자 미상';
    if (Array.isArray(bookInfo.authors) && bookInfo.authors.length > 0) {
      parsedAuthor = bookInfo.authors.join(', ');
    } else if (typeof bookInfo.authors === 'string' && bookInfo.authors.trim() !== '') {
      parsedAuthor = bookInfo.authors;
    } else if (typeof bookInfo.author === 'string' && bookInfo.author.trim() !== '') {
      parsedAuthor = bookInfo.author;
    }

    // 3) 출판사 및 이미지 파싱 (thumbnail 또는 coverImage 지원)
    const publisher = bookInfo.publisher || '민음사';
    const rawCover = bookInfo.thumbnail || bookInfo.coverImage || bookInfo.cover_url || '';
    const coverImage = typeof rawCover === 'string' ? rawCover.replace('http://', 'https://') : '';

    // 4) ISBN 13자리 추출
    let isbn = bookInfo.isbn;
    if (isbn && typeof isbn === 'string') {
      if (isbn.includes(' ')) {
        const isbnArray = isbn.split(' ');
        isbn = isbnArray[1] || isbnArray[0];
      }
      if (isbn.length > 20) {
        isbn = isbn.slice(-13);
      }
    } else {
      isbn = '';
    }

    // 5) [중복 검사] 이미 같은 유저가 해당 ISBN 도서를 담았는지 확인
    if (isbn) {
      const checkQuery = `
        SELECT id FROM user_books 
        WHERE user_id = $1 AND isbn = $2
      `;
      const checkResult = await pool.query(checkQuery, [userId, isbn]);

      if (checkResult.rows.length > 0) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          message: `'${title}'은(는) 이미 내 서재에 등록된 도서입니다.`,
        });
      }
    }

    // 6) DB Insert
    const insertQuery = `
      INSERT INTO user_books (user_id, title, author, publisher, isbn, cover_image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      userId,
      title,
      parsedAuthor,
      publisher,
      isbn,
      coverImage,
      status || 'READING',
    ];

    const result = await pool.query(insertQuery, values);

    return res.status(200).json({
      success: true,
      message: '서재에 성공적으로 추가되었습니다.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('서재 추가 DB 에러:', error);
    return res.status(500).json({
      success: false,
      message: '서재 추가 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
});

// 3. 내 서재 도서 삭제 (DELETE /api/user-books/:id)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deleteQuery = `DELETE FROM user_books WHERE id = $1 RETURNING *`;
    const result = await pool.query(deleteQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: '해당 도서를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      success: true,
      message: '도서가 서재에서 삭제되었습니다.',
    });
  } catch (error) {
    console.error('서재 도서 삭제 에러:', error);
    return res.status(500).json({
      success: false,
      message: '도서 삭제 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
});

// 4. 내 서재 도서 독서 상태 변경 (PATCH /api/user-books/:id/status)
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'WISH', 'READING', 'COMPLETED'

    if (!status) {
      return res.status(400).json({
        success: false,
        message: '변경할 독서 상태 값이 필요합니다.',
      });
    }

    const updateQuery = `
      UPDATE user_books 
      SET status = $1 
      WHERE id = $2 
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [status, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: '해당 도서를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      success: true,
      message: '독서 상태가 업데이트되었습니다.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('독서 상태 변경 에러:', error);
    return res.status(500).json({
      success: false,
      message: '독서 상태 변경 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
});

module.exports = router;