// test/aiValidator.test.js: AI 추천 요청 검증 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRecommendRequest,
  validateCommentSummaryRequest,
  validateReadingReportRequest,
  GENRES,
  TOPICS,
  MOODS,
} = require('../validators/aiValidator');

const EMPTY = { genres: [], topics: [], moods: [], useHistory: false, refresh: false };

test('빈 배열과 빈 body도 허용한다', () => {
  assert.deepEqual(validateRecommendRequest({ genres: [], topics: [], moods: [], useHistory: false }), { ok: true, value: EMPTY });
  assert.deepEqual(validateRecommendRequest({}), { ok: true, value: EMPTY });
  assert.deepEqual(validateRecommendRequest(undefined), { ok: true, value: EMPTY });
});

test('허용값은 그대로 통과하고 useHistory와 refresh를 읽는다', () => {
  const result = validateRecommendRequest({
    genres: ['소설', '시'],
    topics: ['삶과 죽음', '사랑'],
    moods: ['따뜻한', '몰입감 있는'],
    useHistory: true,
    refresh: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    genres: ['소설', '시'],
    topics: ['삶과 죽음', '사랑'],
    moods: ['따뜻한', '몰입감 있는'],
    useHistory: true,
    refresh: true,
  });
});

test('허용 목록은 합의한 값이다', () => {
  assert.deepEqual(GENRES, ['소설', '시', '에세이']);
  assert.deepEqual(TOPICS, ['사랑', '가족', '성장', '사회', '철학', '역사', '일상', '삶과 죽음']);
  assert.deepEqual(MOODS, ['따뜻한', '잔잔한', '깊이 있는', '유쾌한', '어두운', '몰입감 있는']);
});

test('허용값 밖이면 실패한다', () => {
  assert.equal(validateRecommendRequest({ genres: ['판타지'] }).ok, false);
  assert.equal(validateRecommendRequest({ topics: ['사랑 '] }).ok, false);
  assert.equal(validateRecommendRequest({ moods: [1] }).ok, false);
  assert.equal(validateRecommendRequest({ genres: [null] }).ok, false);
});

test('개수 한도를 넘으면 실패한다 (genres 3, topics 3, moods 2)', () => {
  assert.equal(validateRecommendRequest({ genres: ['소설', '시', '에세이'] }).ok, true);
  assert.equal(validateRecommendRequest({ topics: ['사랑', '가족', '성장'] }).ok, true);
  assert.equal(validateRecommendRequest({ topics: ['사랑', '가족', '성장', '사회'] }).ok, false);
  assert.equal(validateRecommendRequest({ moods: ['따뜻한', '잔잔한'] }).ok, true);
  assert.equal(validateRecommendRequest({ moods: ['따뜻한', '잔잔한', '유쾌한'] }).ok, false);
});

test('중복은 제거한 뒤 개수를 센다', () => {
  const result = validateRecommendRequest({ moods: ['따뜻한', '따뜻한'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.moods, ['따뜻한']);
});

test('배열이 아니거나 불리언이 아니면 실패한다', () => {
  assert.equal(validateRecommendRequest({ genres: '소설' }).ok, false);
  assert.equal(validateRecommendRequest({ useHistory: 'true' }).ok, false);
  assert.equal(validateRecommendRequest({ refresh: 1 }).ok, false);
  assert.equal(validateRecommendRequest('문자열').ok, false);
  assert.equal(validateRecommendRequest([]).ok, false);
});

test('실패 결과에는 한국어 메시지가 있다', () => {
  const result = validateRecommendRequest({ genres: ['판타지'] });
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
});

// ---- 댓글 요약 요청 ----

const SUMMARY_ISBN = '9790000000019';

test('댓글 요약: isbn만 있으면 includeSpoilers와 refresh는 false', () => {
  assert.deepEqual(validateCommentSummaryRequest({ isbn: SUMMARY_ISBN }), {
    ok: true,
    value: { isbn: SUMMARY_ISBN, includeSpoilers: false, refresh: false },
  });
});

test('댓글 요약: includeSpoilers와 refresh를 읽고 모르는 필드는 무시한다', () => {
  const result = validateCommentSummaryRequest({
    isbn: '9788937460777',
    includeSpoilers: true,
    refresh: true,
    user_id: 'x',
  });
  assert.deepEqual(result, {
    ok: true,
    value: { isbn: '9788937460777', includeSpoilers: true, refresh: true },
  });
});

test('댓글 요약: isbn이 없거나 형식이 틀리면 거부한다', () => {
  for (const isbn of [undefined, null, '', '123', '978893746077', '97889374607777', 'abcdefghijklm', 9788937460777, ['9788937460777'], '9778937460777']) {
    const result = validateCommentSummaryRequest({ isbn });
    assert.equal(result.ok, false, String(isbn));
    assert.equal(typeof result.message, 'string');
  }
});

test('댓글 요약: body가 없거나 객체가 아니면 거부한다', () => {
  for (const body of [undefined, null, [], 'text', 5]) {
    assert.equal(validateCommentSummaryRequest(body).ok, false, String(body));
  }
});

test('댓글 요약: includeSpoilers와 refresh는 불리언만 허용한다', () => {
  for (const bad of ['true', 'false', 1, 0, null, {}, []]) {
    assert.equal(validateCommentSummaryRequest({ isbn: SUMMARY_ISBN, includeSpoilers: bad }).ok, false, `includeSpoilers ${JSON.stringify(bad)}`);
    assert.equal(validateCommentSummaryRequest({ isbn: SUMMARY_ISBN, refresh: bad }).ok, false, `refresh ${JSON.stringify(bad)}`);
  }
});

// ---- 독서 리포트 요청 ----

test('독서 리포트: period만 있으면 includeNotes는 false', () => {
  assert.deepEqual(validateReadingReportRequest({ period: 'this_month' }), {
    ok: true,
    value: { period: 'this_month', includeNotes: false },
  });
});

test('독서 리포트: period와 includeNotes를 읽고 모르는 필드는 무시한다', () => {
  assert.deepEqual(validateReadingReportRequest({ period: 'last_month', includeNotes: true, user_id: 'x', refresh: true }), {
    ok: true,
    value: { period: 'last_month', includeNotes: true },
  });
});

test('독서 리포트: period가 없거나 허용값이 아니면 거부한다', () => {
  for (const period of [undefined, null, '', 'THIS_MONTH', 'month', 'custom', 'this_month ', 1, ['this_month'], {}]) {
    const result = validateReadingReportRequest({ period });
    assert.equal(result.ok, false, String(period));
    assert.equal(typeof result.message, 'string');
  }
});

test('독서 리포트: body가 없거나 객체가 아니면 거부한다', () => {
  for (const body of [undefined, null, [], 'text', 5]) {
    assert.equal(validateReadingReportRequest(body).ok, false, String(body));
  }
});

test('독서 리포트: includeNotes는 불리언만 허용한다', () => {
  for (const bad of ['true', 'yes', 1, 0, null, {}, []]) {
    assert.equal(validateReadingReportRequest({ period: 'this_month', includeNotes: bad }).ok, false, JSON.stringify(bad));
  }
});
