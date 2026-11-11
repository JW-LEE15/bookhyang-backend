const express = require('express');
const router = express.Router();
const { searchKakaoBooks } = require('../services/kakaoBook');
const { validateListQuery, parseBookId } = require('../validators/bookValidator');
const { listBooks, getBookById, listRelatedBooks } = require('../services/booksCatalog');
const { fetchDescription } = require('../services/kakaoDescription');
const { bookDescriptionLimiter } = require('../middleware/bookLimiters');

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

// ---- 모음집 API (모두 공개, 로그인 불필요) ----
// 라우트 순서가 중요하다: /search -> / -> /:id/description -> /:id/related -> /:id
// (/search가 /:id에 먹히지 않게, 더 구체적인 경로를 먼저 둔다)
// 오류 응답은 { success:false, message } 형식이다. 로그에는 오류 이름과 DB 오류 코드만 남긴다.

const NOT_FOUND_MESSAGE = '도서를 찾을 수 없습니다.';

const sendServerError = (res, error, message) => {
  console.error(`[도서] 오류 name=${error && error.name} dbCode=${error && error.code}`);
  return res.status(500).json({ success: false, message });
};

// 1. 도서 목록 (GET /api/books?category=&sort=&page=&limit=)
router.get('/', async (req, res) => {
  const validation = validateListQuery(req.query);
  if (!validation.ok) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  try {
    const { data, pagination } = await listBooks(validation.value);
    return res.status(200).json({ success: true, data, pagination });
  } catch (error) {
    return sendServerError(res, error, '도서 목록을 불러오지 못했습니다.');
  }
});

// 2. 책 소개글 (GET /api/books/:id/description)
// DB의 ISBN으로 카카오를 호출한다. 클라이언트가 보낸 ISBN은 쓰지 않고, 저장하지도 캐시하지도 않는다.
// 책이 있으면 항상 200이고, 소개글을 못 가져오면 description:null이다.
router.get('/:id/description', bookDescriptionLimiter, async (req, res) => {
  const id = parseBookId(req.params.id);
  if (id === null) {
    return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
  }

  try {
    const book = await getBookById(id);
    if (!book) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const description = await fetchDescription(book.isbn);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: { description } });
  } catch (error) {
    return sendServerError(res, error, '소개글을 불러오지 못했습니다.');
  }
});

// 3. 관련 책 (GET /api/books/:id/related) - 같은 분야 또는 같은 작가, 최대 10권
router.get('/:id/related', async (req, res) => {
  const id = parseBookId(req.params.id);
  if (id === null) {
    return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
  }

  try {
    const book = await getBookById(id);
    if (!book) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    const data = await listRelatedBooks(book);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendServerError(res, error, '관련 도서를 불러오지 못했습니다.');
  }
});

// 4. 도서 한 권 (GET /api/books/:id)
router.get('/:id', async (req, res) => {
  const id = parseBookId(req.params.id);
  if (id === null) {
    return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
  }

  try {
    const book = await getBookById(id);
    if (!book) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }
    return res.status(200).json({ success: true, data: book });
  } catch (error) {
    return sendServerError(res, error, '도서를 불러오지 못했습니다.');
  }
});

module.exports = router;