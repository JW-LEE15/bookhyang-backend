// app.js: 백엔드 서버 메인 파일

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { assertJwtSecret } = require('./config/auth');
const { parseTrustProxyHops } = require('./config/trustProxy');

// JWT_SECRET이 없거나 32자 미만이면 서버를 시작하지 않는다
try {
  assertJwtSecret();
} catch (error) {
  console.error('❌ 서버 시작 중단:', error.message);
  process.exit(1);
}

// TRUST_PROXY_HOPS: 앞단 프록시(Render 등)가 몇 단계인지. 값이 잘못되면 서버를 시작하지 않는다.
// 비어 있으면 trust proxy를 설정하지 않는다. (로컬 개발)
let trustProxyHops = null;
try {
  trustProxyHops = parseTrustProxyHops(process.env.TRUST_PROXY_HOPS);
} catch (error) {
  console.error('❌ 서버 시작 중단:', error.message);
  process.exit(1);
}

// API 라우터 불러오기
const booksRouter = require('./routes/books');
const userBooksRouter = require('./routes/userBooks');
const readingRecordsRouter = require('./routes/readingRecords'); // 독서 기록 (완독일 수정)
const authRouter = require('./routes/auth'); // 인증 라우터 (회원가입, 로그인, 닉네임 수정)
const { profileImageStack } = require('./routes/profileImage'); // 내 프로필 사진 올리기·지우기
const usersRouter = require('./routes/users'); // 사용자 공개 정보 (프로필 사진 보기)
const commentsRouter = require('./routes/comments'); // 책별 댓글 (조회 공개, 작성·삭제 인증)
const aiRouter = require('./routes/ai'); // AI 추천 (로그인 필요)
const readingReportsRouter = require('./routes/readingReports'); // 저장된 AI 독서 리포트 (목록, 삭제)

const app = express();
const PORT = process.env.PORT || 5000;

// IP 기준 횟수 제한이 실제 사용자 IP를 보도록 프록시 단계 수를 알려 준다. (IP 값은 로그에 남기지 않는다)
if (trustProxyHops !== null) {
  app.set('trust proxy', trustProxyHops);
  console.log(`trust proxy: ${trustProxyHops}단계`);
}

// 미들웨어 설정
app.use(cors({
  origin: '*', // 개발 단계 전체 허용 (배포 시 특정 도메인 제한 가능)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));

// 프로필 사진 올리기·지우기는 전역 express.json()(기본 한도 100KB)보다 앞에 둔다.
// base64 사진(약 137KB)을 받으려면 이 경로 전용 150KB 파서가 먼저 본문을 읽어야 한다. (인증 -> 횟수 제한 -> 파서 순서)
app.use('/api/auth/profile-image', ...profileImageStack);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API 라우터 등록
app.use('/api/books', booksRouter);
app.use('/api/user-books', userBooksRouter);
app.use('/api/user-books', readingRecordsRouter);
app.use('/api/auth', authRouter); // 인증 API 엔드포인트 연결 (/api/auth/signup, /api/auth/login)
app.use('/api/users', usersRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/reading-reports', readingReportsRouter);

// 기본 메인 라우트
app.get('/', (req, res) => {
  res.send('📖 민음사 아카이브(bookhyang) 백엔드 API 서버가 정상 실행 중입니다.');
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
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Server] Express 서버가 http://localhost:${PORT} (0.0.0.0)에서 작동 중입니다.`);
});