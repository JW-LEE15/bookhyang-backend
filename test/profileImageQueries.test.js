// test/profileImageQueries.test.js: 댓글 쿼리 4곳이 사진 URL용 컬럼만 읽는지, 서비스 함수가 응답에 반영하는지 확인
// (가짜 pool로 SQL 문장과 결과를 본다. DB·.env 사용 없음. 실제 쿼리 실행은 scripts/test-profile-image.ps1)
const test = require('node:test');
const assert = require('node:assert/strict');
const comments = require('../services/comments');

const ISBN = '9788937460777';
const AUTHOR = '11111111-1111-1111-1111-111111111111';
const UPDATED = new Date(1700000000000);
const EXPECTED_URL = `/api/users/${AUTHOR}/profile-image?v=1700000000000`;

const row = (overrides = {}) => ({
  id: '10', isbn: ISBN, user_id: AUTHOR, content: '내용', created_at: '2026-11-12T00:00:00.000Z',
  nickname: '작성자', profile_image_updated_at: UPDATED, parent_id: null,
  is_spoiler: false, is_hidden: false, deleted_at: null, reply_count: '0', ...overrides,
});

// 호출된 SQL을 모으고, 조건에 맞는 응답을 돌려주는 가짜 pool
const makePool = (rows) => {
  const sqls = [];
  return {
    sqls,
    query: async (sql) => {
      sqls.push(sql);
      if (/JOIN users/.test(sql)) return { rowCount: rows.length, rows }; // 목록·작성·숨김 쿼리 (안쪽 EXISTS보다 먼저 판별)
      if (/FILTER/.test(sql)) return { rowCount: 1, rows: [{ total: '1', top_level_total: '1' }] };
      if (/SELECT 1 FROM comments/.test(sql)) return { rowCount: 1, rows: [{}] };
      if (/COUNT[(][*][)] AS total FROM comments/.test(sql)) return { rowCount: 1, rows: [{ total: '1' }] };
      return { rowCount: rows.length, rows };
    },
  };
};

// 사진 URL용 시각 컬럼은 읽고, 사진 바이트 컬럼(profile_image 단독)은 읽지 않는다
const assertReadsOnlyUpdatedAt = (sql, label) => {
  assert.ok(sql.includes('u.profile_image_updated_at'), `${label}: 시각 컬럼이 없다`);
  assert.equal(sql.replaceAll('profile_image_updated_at', '').includes('profile_image'), false, `${label}: 사진 바이트를 읽는다`);
};

test('목록 쿼리: 사진 시각 컬럼을 읽고 응답에 profile_image_url이 있다', async () => {
  const pool = makePool([row()]);
  const out = await comments.listComments(pool, { isbn: ISBN, limit: 20 });
  assertReadsOnlyUpdatedAt(pool.sqls[0], '목록');
  assert.equal(out.data[0].profile_image_url, EXPECTED_URL);
});

test('답글 쿼리: 사진 시각 컬럼을 읽고 응답에 profile_image_url이 있다', async () => {
  const pool = makePool([row({ id: '11', parent_id: '10' })]);
  const out = await comments.listReplies(pool, { id: '10', limit: 20 });
  assert.equal(out.result, 'ok');
  const listSql = pool.sqls.find((sql) => /JOIN users/.test(sql));
  assertReadsOnlyUpdatedAt(listSql, '답글');
  assert.equal(out.data[0].profile_image_url, EXPECTED_URL);
});

test('작성 쿼리(원댓글·답글): 사진 시각 컬럼을 읽고 응답에 profile_image_url이 있다', async () => {
  for (const parentId of [null, '10']) {
    const pool = makePool([row({ parent_id: parentId })]);
    const out = await comments.createComment(pool, { userId: AUTHOR, isbn: ISBN, content: '내용', parentId });
    assert.equal(out.result, 'ok');
    assertReadsOnlyUpdatedAt(pool.sqls[0], `작성(parent=${parentId})`);
    assert.equal(out.data.profile_image_url, EXPECTED_URL);
  }
});

test('숨김 쿼리: 사진 시각 컬럼을 읽고 응답에 profile_image_url이 있다', async () => {
  const pool = makePool([row({ is_hidden: true })]);
  const out = await comments.setHidden(pool, { userId: AUTHOR, id: '10', isHidden: true });
  assert.equal(out.result, 'ok');
  assertReadsOnlyUpdatedAt(pool.sqls[0], '숨김');
  assert.equal(out.data.profile_image_url, EXPECTED_URL);
});

test('사진이 없는 사용자의 댓글은 profile_image_url이 null', async () => {
  const pool = makePool([row({ profile_image_updated_at: null })]);
  const out = await comments.listComments(pool, { isbn: ISBN, limit: 20 });
  assert.equal(out.data[0].profile_image_url, null);
});
