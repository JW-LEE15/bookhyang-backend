// test/aiValidator.test.js: AI 추천 요청 검증 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecommendRequest, GENRES, TOPICS, MOODS } = require('../validators/aiValidator');

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
