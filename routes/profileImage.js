// routes/profileImage.js: 내 프로필 사진 올리기·지우기 (PUT, DELETE /api/auth/profile-image)
// app.js에서 전역 express.json()보다 앞에 profileImageStack을 통째로 등록한다.
//  - 전역 파서의 기본 한도(100KB)로는 base64 사진(약 137KB)을 못 받는다. 이 경로만 150KB 파서를 쓴다.
//  - 순서는 인증 -> 횟수 제한 -> 본문 파서라서, 로그인하지 않은 요청은 본문을 읽지 않는다.
//  - 본문 파서의 오류(너무 큼, 깨진 JSON)는 이 파일의 오류 처리기가 받는다.
//    전역 오류 처리기는 err.stack을 찍는데, 깨진 JSON의 오류 메시지에는 본문 일부가 들어갈 수 있어서 거치지 않게 한다.
// 사진 데이터(req.body)와 바이트는 로그에 남기지 않는다. 오류 로그에는 오류 종류만 남긴다.
const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { profileImageLimiter } = require('../middleware/profileImageLimiter');
const { validateProfileImageBody } = require('../validators/profileImageValidator');
const { setProfileImage, clearProfileImage, toPublicUser } = require('../services/profileImage');
const { describeError } = require('../services/safeError');

const BODY_LIMIT = '150kb';
const USER_NOT_FOUND_MESSAGE = '사용자를 찾을 수 없습니다.';

const router = express.Router();

// 사진 올리기 (PUT /api/auth/profile-image) body: { image: '<base64>' }
router.put('/', async (req, res) => {
  try {
    const validation = validateProfileImageBody(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({
        success: false,
        ...(validation.code ? { code: validation.code } : {}),
        message: validation.message,
      });
    }

    const row = await setProfileImage(pool, { userId: req.userId, ...validation.value });
    if (!row) {
      // 토큰은 유효하지만 계정이 없는 경우 (탈퇴 등)
      return res.status(404).json({ success: false, message: USER_NOT_FOUND_MESSAGE });
    }

    return res.status(200).json({
      success: true,
      message: '프로필 사진이 변경되었습니다.',
      user: toPublicUser(row),
    });
  } catch (error) {
    console.error('프로필 사진 저장 실패:', describeError(error));
    return res.status(500).json({ success: false, message: '프로필 사진 저장 중 오류가 발생했습니다.' });
  }
});

// 사진 지우기 (DELETE /api/auth/profile-image) - 사진이 없어도 200
router.delete('/', async (req, res) => {
  try {
    const row = await clearProfileImage(pool, { userId: req.userId });
    if (!row) {
      return res.status(404).json({ success: false, message: USER_NOT_FOUND_MESSAGE });
    }

    return res.status(200).json({
      success: true,
      message: '프로필 사진을 삭제했습니다.',
      user: toPublicUser(row),
    });
  } catch (error) {
    console.error('프로필 사진 삭제 실패:', describeError(error));
    return res.status(500).json({ success: false, message: '프로필 사진 삭제 중 오류가 발생했습니다.' });
  }
});

const SAFE_TYPE_PATTERN = /^[A-Za-z0-9_.]{1,40}$/;

// 본문 파서와 이 경로 안에서 난 오류를 응답으로 바꾼다. 로그에는 오류 종류(type 또는 name)만 남긴다.
// (4개 인자를 가져야 Express가 오류 처리기로 인식한다)
// eslint-disable-next-line no-unused-vars
const handleProfileImageError = (err, req, res, next) => {
  const rawType = err && typeof err === 'object' ? (err.type || err.name) : undefined;
  const type = typeof rawType === 'string' && SAFE_TYPE_PATTERN.test(rawType) ? rawType : 'unknown';
  console.warn('프로필 사진 요청 처리 실패:', type);

  if (res.headersSent) return undefined;

  if (type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'IMAGE_TOO_LARGE',
      message: '사진 용량이 너무 큽니다. (최대 100KB)',
    });
  }
  const status = err && (err.status || err.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(400).json({ success: false, message: '요청 본문을 읽을 수 없습니다.' });
  }
  return res.status(500).json({ success: false, message: '프로필 사진 처리 중 오류가 발생했습니다.' });
};

// app.use('/api/auth/profile-image', ...profileImageStack) 로 등록한다.
const profileImageStack = [
  requireAuth,
  profileImageLimiter,
  express.json({ limit: BODY_LIMIT }),
  router,
  handleProfileImageError,
];

module.exports = {
  BODY_LIMIT,
  profileImageStack,
  handleProfileImageError,
};
