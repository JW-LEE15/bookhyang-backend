// services/profileImage.js: 프로필 사진 DB 로직과 응답용 URL 조립
//  - 순수 함수: buildProfileImageUrl, toPublicUser, isUuid
//  - DB 함수(pool을 첫 인자로 받는다): setProfileImage, clearProfileImage, getProfileImage
// 이 파일에는 로그 출력이 없다. 사진 바이트는 getProfileImage 말고는 어느 쿼리에서도 읽지 않는다.
// 모든 쓰기 쿼리는 토큰의 userId(WHERE id = $1)로만 대상을 정한다.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

// 사진 URL (서버 주소를 뺀 상대 경로). 사진이 없으면 null.
// v는 올린 시각(ms)이라서 사진이 바뀌면 URL이 달라져 캐시가 갱신된다.
// updatedAt은 pg가 주는 Date이거나 ISO 문자열이다.
const buildProfileImageUrl = (userId, updatedAt) => {
  if (!isUuid(userId) || updatedAt === null || updatedAt === undefined) return null;
  const version = new Date(updatedAt).getTime();
  if (Number.isNaN(version)) return null;
  return `/api/users/${userId}/profile-image?v=${version}`;
};

// 로그인·닉네임·사진 응답에 쓰는 user 객체. 필요한 필드만 담는다. (password, 사진 바이트 제외)
const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  nickname: row.nickname,
  created_at: row.created_at,
  profile_image_url: buildProfileImageUrl(row.id, row.profile_image_updated_at),
});

// 쓰기 쿼리가 돌려주는 컬럼 (사진 바이트는 돌려받지 않는다)
const USER_COLUMNS = 'id, email, nickname, created_at, profile_image_updated_at';

// 내 사진을 저장한다. 반환: 사용자 행 | null (계정이 없음)
const setProfileImage = async (pool, { userId, buffer, mime }) => {
  const result = await pool.query(
    `UPDATE users
        SET profile_image = $2::bytea, profile_image_type = $3::text, profile_image_updated_at = now()
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId, buffer, mime]
  );
  return result.rows[0] || null;
};

// 내 사진을 지운다. 이미 없어도 성공이다. 반환: 사용자 행 | null (계정이 없음)
const clearProfileImage = async (pool, { userId }) => {
  const result = await pool.query(
    `UPDATE users
        SET profile_image = NULL, profile_image_type = NULL, profile_image_updated_at = NULL
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId]
  );
  return result.rows[0] || null;
};

// 사진을 읽는다. 반환: { buffer, mime } | null (사용자나 사진이 없음, 또는 uuid 형식이 아님)
const getProfileImage = async (pool, { userId }) => {
  if (!isUuid(userId)) return null;
  const result = await pool.query(
    `SELECT profile_image, profile_image_type
       FROM users
      WHERE id = $1 AND profile_image IS NOT NULL`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { buffer: row.profile_image, mime: row.profile_image_type };
};

module.exports = {
  isUuid,
  buildProfileImageUrl,
  toPublicUser,
  setProfileImage,
  clearProfileImage,
  getProfileImage,
};
