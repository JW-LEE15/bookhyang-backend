const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');

// 회원가입 API (POST /api/auth/signup)
router.post('/signup', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({
        success: false,
        message: '이메일, 비밀번호, 닉네임을 모두 입력해 주세요.',
      });
    }

    // 이메일 중복 체크
    const checkUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (checkUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.',
      });
    }

    // 비밀번호 해시 암호화
    const hashedPassword = await bcrypt.hash(password, 10);

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
    console.error('회원가입 에러:', error);
    return res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
});

// 이메일 로그인 API (POST /api/auth/login)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '이메일과 비밀번호를 입력해 주세요.',
      });
    }

    // 유저 존재 여부 확인
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '존재하지 않는 이메일입니다.',
      });
    }

    const user = userResult.rows[0];

    // 비밀번호 검증
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '비밀번호가 일치하지 않습니다.',
      });
    }

    // 비밀번호 정보 제외 후 응답
    delete user.password;

    return res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      user,
    });
  } catch (error) {
    console.error('로그인 에러:', error);
    return res.status(500).json({
      success: false,
      message: '로그인 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
});

module.exports = router;