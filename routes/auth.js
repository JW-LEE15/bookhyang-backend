const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { validateSignup, validateLogin } = require('../validators/authValidator');
const { signToken } = require('../config/auth');

const SALT_ROUNDS = 10;
const LOGIN_FAIL_MESSAGE = '이메일 또는 비밀번호가 일치하지 않습니다.';
const DUPLICATE_EMAIL_MESSAGE = '이미 가입된 이메일입니다.';

// 없는 이메일로 로그인할 때도 비교 시간을 맞추기 위한 더미 해시 (서버 시작 시 한 번 생성)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);

// 회원가입 API (POST /api/auth/signup)
router.post('/signup', async (req, res) => {
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

// 이메일 로그인 API (POST /api/auth/login)
router.post('/login', async (req, res) => {
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
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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

    // 비밀번호 정보 제외 후 응답
    delete user.password;

    // 서재 API에 쓸 로그인 토큰 (만료 7일)
    const token = signToken(user.id);

    return res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      user,
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

module.exports = router;