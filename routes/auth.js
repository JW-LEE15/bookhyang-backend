const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { validateSignup, validateLogin, validateNicknameUpdate } = require('../validators/authValidator');
const { signToken } = require('../config/auth');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimiters');
const { nicknameLimiter } = require('../middleware/nicknameLimiter');
const requireAuth = require('../middleware/requireAuth');
const { toPublicUser } = require('../services/profileImage');

const SALT_ROUNDS = 10;
const LOGIN_FAIL_MESSAGE = '이메일 또는 비밀번호가 일치하지 않습니다.';
const DUPLICATE_EMAIL_MESSAGE = '이미 가입된 이메일입니다.';

// 없는 이메일로 로그인할 때도 비교 시간을 맞추기 위한 더미 해시 (서버 시작 시 한 번 생성)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);

// 회원가입 API (POST /api/auth/signup) - IP당 1시간 10회
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const validation = validateSignup(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }
    const { email, password, nickname } = validation.value;

    // 이메일 중복 체크
    const checkUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (checkUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: DUPLICATE_EMAIL_MESSAGE,
      });
    }

    // 비밀번호 해시 암호화
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // DB Insert
    const insertQuery = `
      INSERT INTO users (email, password, nickname)
      VALUES ($1, $2, $3)
      RETURNING id, email, nickname, created_at
    `;
    const newUser = await pool.query(insertQuery, [email, hashedPassword, nickname]);

    return res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      user: newUser.rows[0],
    });
  } catch (error) {
    // 동시에 같은 이메일로 가입해 UNIQUE 제약(users_email_key)에 걸린 경우
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: DUPLICATE_EMAIL_MESSAGE,
      });
    }
    console.error('회원가입 에러:', error);
    return res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.',
    });
  }
});

// 이메일 로그인 API (POST /api/auth/login) - IP당 15분 10회, 성공한 요청은 세지 않음
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const validation = validateLogin(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }
    const { email, password } = validation.value;

    // 유저 존재 여부 확인
    // 컬럼을 명시한다. SELECT *로는 프로필 사진 바이트(profile_image)까지 읽게 된다.
    const userResult = await pool.query(
      `SELECT id, email, password, nickname, created_at, profile_image_updated_at
         FROM users WHERE email = $1`,
      [email]
    );
    if (userResult.rows.length === 0) {
      // 없는 이메일이어도 bcrypt 비교를 한 번 해서 응답 시간을 비슷하게 맞춘다
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: LOGIN_FAIL_MESSAGE,
      });
    }

    const user = userResult.rows[0];

    // 비밀번호 검증
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: LOGIN_FAIL_MESSAGE,
      });
    }

    // 서재 API에 쓸 로그인 토큰 (만료 7일)
    const token = signToken(user.id);

    // 비밀번호는 응답에서 제외하고, 사진은 바이트 대신 URL(profile_image_url)로 알려 준다
    return res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      user: toPublicUser(user),
      token,
    });
  } catch (error) {
    console.error('로그인 에러:', error);
    return res.status(500).json({
      success: false,
      message: '로그인 처리 중 오류가 발생했습니다.',
    });
  }
});

// 닉네임 수정 API (PATCH /api/auth/nickname) - 로그인 필요, 사용자당 1시간 10회
// 닉네임 중복은 허용한다. (가입과 같음) 댓글은 users를 조인해서 닉네임을 읽으므로 과거 댓글에도 바로 반영된다.
router.patch('/nickname', requireAuth, nicknameLimiter, async (req, res) => {
  try {
    const validation = validateNicknameUpdate(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const updated = await pool.query(
      `UPDATE users SET nickname = $2
        WHERE id = $1
        RETURNING id, email, nickname, created_at, profile_image_updated_at`,
      [req.userId, validation.value.nickname]
    );
    if (updated.rows.length === 0) {
      // 토큰은 유효하지만 계정이 없는 경우 (탈퇴 등)
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      success: true,
      message: '닉네임이 변경되었습니다.',
      user: toPublicUser(updated.rows[0]),
    });
  } catch (error) {
    console.error('닉네임 수정 에러:', error.message);
    return res.status(500).json({
      success: false,
      message: '닉네임 변경 중 오류가 발생했습니다.',
    });
  }
});

module.exports = router;