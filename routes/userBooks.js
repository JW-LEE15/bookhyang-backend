const express = require('express');
const router = express.Router();
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { todayKst } = require('../services/kstDate');
const { normalizeStatus } = require('../validators/readingValidator');

const NOT_FOUND_MESSAGE = '해당 도서를 찾을 수 없습니다.';
const PG_INTEGER_MAX = 2147483647; // user_books.id는 integer

// 모든 서재 API는 로그인 토큰이 필요하다. 요청자 id는 req.userId (토큰에서 꺼냄)
router.use(requireAuth);

// URL의 책 id가 양의 정수(integer 범위)면 숫자로, 아니면 null
const parseBookId = (raw) => {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return id <= PG_INTEGER_MAX ? id : null;
};

// 1. 내 서재 도서 목록 조회 (GET /api/user-books)
router.get('/', async (req, res) => {
  try {
    // 💡 description (줄거리/소개) 컬럼을 SELECT 항목에 추가
    const query = `
      SELECT id, user_id, title, author, publisher, isbn, cover_image, description, status, created_at, read_end_date
      FROM user_books
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [req.userId]);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('서재 목록 조회 실패:', error);
    return res.status(500).json({
      success: false,
      message: '서재 목록 조회 실패',
    });
  }
});

// 2. 내 서재에 도서 추가 (POST /api/user-books) - 중복 체크 및 데이터 파싱 포함
router.post('/', async (req, res) => {
  try {
    const userId = req.userId; // body의 userId는 쓰지 않는다
    const { bookInfo, status } = req.body || {};

    if (!bookInfo) {
      return res.status(400).json({
        success: false,
        message: '도서 정보는 필수입니다.',
      });
    }

    // 독서 상태: 생략(undefined/null)하면 READING을 명시적으로 넣고(DB 기본값에 의존하지 않음),
    // 값이 있으면 READING/COMPLETED/WISH만 허용한다 (대소문자만 다른 값은 대문자로 바꿈)
    let finalStatus = 'READING';
    if (status !== undefined && status !== null) {
      const statusResult = normalizeStatus(status);
      if (!statusResult.ok) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: statusResult.message });
      }
      finalStatus = statusResult.value;
    }

    // 1) 제목 파싱
    const title = bookInfo.title || '제목 없음';

    // 2) 저자 파싱
    let parsedAuthor = '저자 미상';
    if (Array.isArray(bookInfo.authors) && bookInfo.authors.length > 0) {
      parsedAuthor = bookInfo.authors.join(', ');
    } else if (typeof bookInfo.authors === 'string' && bookInfo.authors.trim() !== '') {
      parsedAuthor = bookInfo.authors;
    } else if (typeof bookInfo.author === 'string' && bookInfo.author.trim() !== '') {
      parsedAuthor = bookInfo.author;
    }

    // 3) 출판사 및 이미지 파싱
    const publisher = bookInfo.publisher || '민음사';
    const rawCover = bookInfo.thumbnail || bookInfo.coverImage || bookInfo.cover_url || '';
    const coverImage = typeof rawCover === 'string' ? rawCover.replace('http://', 'https://') : '';

    // 4) 💡 도서 줄거리/소개 파싱 보완 (contents, description, summary 호환)
    const description =
      bookInfo.contents ||
      bookInfo.description ||
      bookInfo.summary ||
      '상세 줄거리 정보가 제공되지 않는 도서입니다.';

    // 5) ISBN 13자리 추출
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

    // 6) [중복 검사]
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

    // 7) 💡 DB Insert (description 컬럼 및 값 추가)
    // 처음부터 완독으로 담으면 완독일에 오늘(한국 시간)을 넣는다. 그 외 상태는 NULL
    const insertQuery = `
      INSERT INTO user_books (user_id, title, author, publisher, isbn, cover_image, description, status, read_end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)
      RETURNING *
    `;

    const values = [
      userId,
      title,
      parsedAuthor,
      publisher,
      isbn,
      coverImage,
      description,
      finalStatus,
      finalStatus === 'COMPLETED' ? todayKst(new Date()) : null,
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
    });
  }
});

// 3. 내 서재 도서 삭제 (DELETE /api/user-books/:id) - 본인 책만. 남의 책·없는 책은 똑같이 404
router.delete('/:id', async (req, res) => {
  try {
    const id = parseBookId(req.params.id);
    if (id === null) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const deleteQuery = `DELETE FROM user_books WHERE id = $1 AND user_id = $2 RETURNING id`;
    const result = await pool.query(deleteQuery, [id, req.userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: NOT_FOUND_MESSAGE,
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
    });
  }
});

// 4. 내 서재 도서 독서 상태 변경 (PATCH /api/user-books/:id/status) - 본인 책만. 남의 책·없는 책은 똑같이 404
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseBookId(req.params.id);
    if (id === null) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const { status: rawStatus } = req.body || {};

    if (!rawStatus) {
      return res.status(400).json({
        success: false,
        message: '변경할 독서 상태 값이 필요합니다.',
      });
    }

    const statusResult = normalizeStatus(rawStatus);
    if (!statusResult.ok) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: statusResult.message });
    }
    const status = statusResult.value;

    // 완독으로 바꾸면 완독일이 비어 있을 때만 오늘(한국 시간)을 넣고, 이미 있으면 유지한다.
    // 완독이 아닌 상태로 바꾸면 완독일을 지운다. (완독일이 있으면 완독이라는 규칙 유지)
    const updateQuery = `
      UPDATE user_books
      SET status = $1,
          read_end_date = CASE WHEN $4::boolean
            THEN COALESCE(read_end_date, $5::date)
            ELSE NULL END
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [
      status,
      id,
      req.userId,
      status === 'COMPLETED',
      todayKst(new Date()),
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: NOT_FOUND_MESSAGE,
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
    });
  }
});

module.exports = router;
