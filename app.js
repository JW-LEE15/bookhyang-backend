// app.js: 백엔드 서버 메인 파일

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

// API 라우터 불러오기
const booksRouter = require('./routes/books');
const userBooksRouter = require('./routes/userBooks');
const authRouter = require('./routes/auth'); // 인증 라우터 (회원가입, 로그인)

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
app.use(cors({
  origin: '*', // 개발 단계 전체 허용 (배포 시 특정 도메인 제한 가능)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API 라우터 등록
app.use('/api/books', booksRouter);
app.use('/api/user-books', userBooksRouter);
app.use('/api/auth', authRouter); // 인증 API 엔드포인트 연결 (/api/auth/signup, /api/auth/login)

// 기본 메인 및 DB 테스트 라우트
app.get('/', (req, res) => {
  res.send('📖 민음사 아카이브(bookhyang) 백엔드 API 서버가 정상 실행 중입니다.');
});

app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.status(200).json({ 
      success: true, 
      message: 'Supabase DB 연동 성공!', 
      dbTime: result.rows[0].now 
    });
  } catch (error) {
    console.error('DB 연동 테스트 에러:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'DB 연동 실패', 
      error: error.message 
    });
  }
});

// 404 라우트 처리 미들웨어
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `요청하신 경로 (${req.originalUrl})를 찾을 수 없습니다.`,
  });
});

// 전역 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error('서버 전역 에러 발생:', err.stack);
  res.status(500).json({
    success: false,
    message: '서버 내부 오류가 발생했습니다.',
    error: err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Server] Express 서버가 http://localhost:${PORT} (0.0.0.0)에서 작동 중입니다.`);
});