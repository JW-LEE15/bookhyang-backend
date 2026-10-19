const express = require('express');
const router = express.Router();
const { searchKakaoBooks } = require('../services/kakaoBook');

// 도서 검색 API 라우트
router.get('/search', async (req, res) => {
  const { query } = req.query;
  console.log(`[도서 검색 요청] 검색어: "${query}"`);

  try {
    const books = await searchKakaoBooks(query);
    console.log(`[검색 완료] 민음사 필터링 도서 수: ${books.length}권`);

    // documents 객체 포맷과 배열 포맷 둘 다 대응 가능하도록 응답
    return res.json({
      documents: books,
      books: books,
    });
  } catch (error) {
    console.error('❌ routes/books.js 에러:', error.message);
    return res.status(500).json({ error: '도서 정보를 가져올 수 없습니다.' });
  }
});

module.exports = router;