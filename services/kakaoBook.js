const axios = require('axios');

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY;

// 한글 초성 추출 내장 함수
const getChosungCustom = (str) => {
  const CHOSUNG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ',
    'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ',
    'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];

  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 44032;
    if (code >= 0 && code <= 11172) {
      const chosungIndex = Math.floor(code / 588);
      result += CHOSUNG[chosungIndex];
    } else {
      result += str[i];
    }
  }
  return result;
};

// 초성 및 부분 단어 힌트 매핑
const mapQueryToSearchKeyword = (query) => {
  const map = {
    'ㄷㅁㅇ': '데미안',
    '데': '데미안',
    '데미': '데미안',
    'ㅇㅇ': '이방인',
    '이방': '이방인',
    'ㄱㄹ': '구운몽',
    'ㅎㄹ': '헤르만',
  };
  return map[query] || '';
};

/**
 * 카카오 도서 검색 및 민음사/초성/부분단어 필터링 함수
 */
const searchKakaoBooks = async (query) => {
  if (!query || !query.trim()) {
    return [];
  }

  const cleanQuery = query.trim();
  const isChosungOnly = /^[ㄱ-ㅎ\s]+$/.test(cleanQuery);

  try {
    let fetchQueries = [];

    const mappedKeyword = mapQueryToSearchKeyword(cleanQuery);
    if (mappedKeyword) {
      fetchQueries.push(`${mappedKeyword} 민음사`);
    }

    if (isChosungOnly) {
      fetchQueries.push('민음사');
    } else {
      fetchQueries.push(`${cleanQuery} 민음사`);
      fetchQueries.push(cleanQuery);
      fetchQueries.push('민음사');
    }

    let rawBooks = [];
    for (const q of fetchQueries) {
      try {
        const response = await axios.get('https://dapi.kakao.com/v3/search/book', {
          params: { query: q, size: 50 },
          headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
        });
        if (response.data && response.data.documents) {
          rawBooks = [...rawBooks, ...response.data.documents];
        }
      } catch (err) {
        // 개별 카카오 API 요청 에러 발생 시 백엔드 500 에러를 유발하지 않고 스킵
        console.log(`[안내] 쿼리 "${q}" 검색 스킵:`, err.message);
      }
    }

    // 민음사 출판사 필터링 및 중복 제거
    const minumsaBooks = rawBooks.filter(
      (book) => book.publisher && book.publisher.includes('민음사')
    );

    const uniqueBooks = Array.from(
      new Map(minumsaBooks.map((book) => [book.isbn || book.title, book])).values()
    );

    // 정밀 필터링
    const filteredBooks = uniqueBooks.filter((book) => {
      const title = (book.title || '').replace(/[\(\)\[\]]/g, ' ');
      const authors = Array.isArray(book.authors) ? book.authors.join(' ') : book.authors || '';
      const targetText = `${title} ${authors}`;

      if (isChosungOnly) {
        const targetChosung = getChosungCustom(targetText);
        const cleanTargetChosung = targetChosung.replace(/\s+/g, '');
        const cleanQueryChosung = cleanQuery.replace(/\s+/g, '');

        return (
          cleanTargetChosung.includes(cleanQueryChosung) ||
          targetChosung.includes(cleanQuery)
        );
      } else {
        const cleanTargetText = targetText.toLowerCase().replace(/\s+/g, '');
        const cleanSearchQuery = cleanQuery.toLowerCase().replace(/\s+/g, '');

        return cleanTargetText.includes(cleanSearchQuery);
      }
    });

    return filteredBooks;
  } catch (error) {
    // 백엔드가 터져서 500을 뱉는 대신 빈 배열을 돌려주어 프론트엔드 에러 팝업 방지
    console.error('⚠️ 검색 중 처리 예외 발생 (빈 목록 반환):', error.message);
    return [];
  }
};

module.exports = {
  searchKakaoBooks,
};