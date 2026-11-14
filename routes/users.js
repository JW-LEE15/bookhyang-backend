// routes/users.js: 사용자 공개 정보 (GET /api/users/:id/profile-image)
// 프로필 사진은 공개다. 댓글 목록이 공개이고 user_id도 이미 응답에 들어 있어서, 앱의 이미지 컴포넌트가
// 인증 헤더 없이 불러올 수 있게 했다. 사진이 없거나 id가 uuid 형식이 아니거나 사용자가 없으면 똑같이 404.
// 오류 로그에는 오류 이름과 DB 오류 코드만 남긴다.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getProfileImage } = require('../services/profileImage');
const { describeError } = require('../services/safeError');

const NOT_FOUND_MESSAGE = '프로필 사진을 찾을 수 없습니다.';

router.get('/:id/profile-image', async (req, res) => {
  try {
    const image = await getProfileImage(pool, { userId: req.params.id });
    if (!image) {
      return res.status(404).json({ success: false, message: NOT_FOUND_MESSAGE });
    }

    // 사진이 바뀌면 응답의 URL(?v=)이 바뀌므로 하루 동안 캐시해도 된다
    res.set({
      'Content-Type': image.mime,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(image.buffer);
  } catch (error) {
    console.error('프로필 사진 조회 실패:', describeError(error));
    return res.status(500).json({ success: false, message: '프로필 사진 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
