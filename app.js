// app.js: 백엔드 서버 메인 파일

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const booksRouter = require('./routes/books');
const userBooksRouter = require('./routes/userBooks');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// API 라우터 등록
app.use('/api/books', booksRouter);
app.use('/api/user-books', userBooksRouter);

// 기본 메인 및 DB 테스트 라우트
app.get('/', (req, res) => {
  res.send('📖 민음사 아카이브(bookhyang) 백엔드 API 서버가 정상 실행 중입니다.');
});

app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.status(200).json({ success: true, message: 'Supabase DB 연동 성공!', dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB 연동 실패', error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Server] Express 서버가 http://localhost:${PORT} (0.0.0.0)에서 작동 중입니다.`);
});