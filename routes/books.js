const express = require('express');
const axios = require('axios');
const router = express.Router();

// 카카오 도서 검색 API
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ success: false, message: '검색어를 입력해 주세요.' });
    }

    const response = await axios.get('https://dapi.kakao.com/v3/search/book', {
      params: { query },
      headers: {
        Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
      },
    });

    // 썸네일 URL을 HTTPS로 안전 변환하여 전달
    const books = response.data.documents.map((book) => ({
      title: book.title,
      authors: book.authors,
      publisher: book.publisher,
      isbn: book.isbn,
      thumbnail: book.thumbnail ? book.thumbnail.replace('http://', 'https://') : '',
      coverImage: book.thumbnail ? book.thumbnail.replace('http://', 'https://') : '',
      contents: book.contents,
      url: book.url,
    }));

    return res.status(200).json({
      success: true,
      data: books,
    });
  } catch (error) {
    console.error('카카오 도서 검색 실패:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: '도서 검색 실패',
      error: error.message,
    });
  }
});

module.exports = router;