const axios = require('axios');
require('dotenv').config();

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_BOOK_URL = 'https://dapi.kakao.com/v3/search/book';

const searchBooksFromKakao = async (query) => {
  try {
    const response = await axios.get(KAKAO_BOOK_URL, {
      headers: {
        Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`
      },
      params: {
        query: query,
        size: 20
      }
    });

    const documents = response.data.documents || [];

    return documents.map(book => ({
      title: book.title,
      author: book.authors.join(', '),
      publisher: book.publisher,
      pubDate: book.datetime ? book.datetime.substring(0, 10) : null,
      isbn: book.isbn,
      coverImage: book.thumbnail,
      description: book.contents
    }));
  } catch (error) {
    console.error('카카오 도서 API 오류:', error.response?.data || error.message);
    throw new Error('도서 정보를 가져오는데 실패했습니다.');
  }
};

module.exports = {
  searchBooksFromKakao
};