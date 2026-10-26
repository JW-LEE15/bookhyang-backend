// routes/auth.js
const express = require('express');
const router = express.Router();
const authService = require('../services/authService');

// POST /api/auth/signup - 회원가입
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 모두 입력해 주세요.' });
    }

    const result = await authService.signUp(email, password, name);
    res.status(201).json({
      message: '회원가입 성공',
      user: result.user,
      session: result.session,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/login - 로그인
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 모두 입력해 주세요.' });
    }

    const result = await authService.signIn(email, password);
    res.status(200).json({
      message: '로그인 성공',
      token: result.session.access_token,
      user: result.user,
    });
  } catch (error) {
    res.status(401).json({ error: error.message || '로그인에 실패했습니다.' });
  }
});

module.exports = router;