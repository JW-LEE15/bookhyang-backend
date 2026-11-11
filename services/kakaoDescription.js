// services/kakaoDescription.js: 카카오 책 검색(target=isbn)으로 책 소개글을 가져온다.
// - 호출에 쓰는 ISBN은 항상 서버가 DB에서 꺼낸 값이다. 클라이언트가 보낸 값은 쓰지 않는다.
// - 소개글은 저장하지도 캐시하지도 않는다. 호출할 때마다 카카오에서 새로 가져온다.
// - 실패(키 없음, 시간 초과, 오류 응답, 결과 없음)는 예외 대신 null을 돌려준다. 호출한 쪽은 description:null로 응답한다.
// 로그에는 상태 코드와 오류 이름만 남긴다. (키, ISBN, 소개글은 남기지 않는다)
const { normalizeIsbn13 } = require('./isbn');

const KAKAO_BOOK_URL = 'https://dapi.kakao.com/v3/search/book';
const TIMEOUT_MS = 5000;

// ---- 순수 함수 (테스트 대상) ----

// 카카오 검색 결과(documents)에서 ISBN이 일치하는 책의 소개글(contents)을 꺼낸다.
// 카카오의 isbn 필드는 "ISBN10 ISBN13" 형태다. 일치하는 책이 없거나 소개글이 비어 있으면 null.
const extractDescription = (documents, isbn13) => {
  if (!Array.isArray(documents) || typeof isbn13 !== 'string') return null;

  const match = documents.find((doc) => {
    if (!doc || typeof doc.isbn !== 'string') return false;
    return doc.isbn.split(/\s+/).map((token) => token.replace(/-/g, '')).includes(isbn13);
  });
  if (!match || typeof match.contents !== 'string') return null;

  const text = match.contents.trim();
  return text === '' ? null : text;
};

// ---- 카카오 호출 ----

let warnedNoKey = false;

// 소개글 문자열을 돌려주거나, 어떤 이유로든 못 가져오면 null. 예외를 던지지 않는다.
const fetchDescription = async (isbn, { fetchImpl = fetch } = {}) => {
  const isbn13 = normalizeIsbn13(isbn);
  if (!isbn13) return null;

  const apiKey = (process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || '').trim();
  if (!apiKey) {
    if (!warnedNoKey) {
      console.warn('[책 소개글] 카카오 API 키가 없어 소개글을 가져올 수 없습니다. (KAKAO_API_KEY 확인)');
      warnedNoKey = true;
    }
    return null;
  }

  const url = new URL(KAKAO_BOOK_URL);
  url.searchParams.set('target', 'isbn');
  url.searchParams.set('query', isbn13);

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[책 소개글] 카카오 응답 실패 status=${response.status}`);
      return null;
    }
    const json = await response.json();
    return extractDescription(json && json.documents, isbn13);
  } catch (error) {
    console.warn(`[책 소개글] 카카오 호출 실패 name=${error && error.name}`);
    return null;
  }
};

module.exports = {
  KAKAO_BOOK_URL,
  TIMEOUT_MS,
  extractDescription,
  fetchDescription,
};
