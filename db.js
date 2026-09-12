// db.js: PostgreSQL(Supabase) 데이터베이스 연결 관리 모듈

// .env 파일의 환경변수(DB 접속 주소 등)를 읽어옵니다.
require('dotenv').config();

// PostgreSQL 연결을 위한 pg 모듈의 Pool 객체를 불러옵니다.
const { Pool } = require('pg');

// Supabase DB 연결 설정을 진행합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // 클라우드 DB 접속을 위한 SSL 보안 연결 설정
    rejectUnauthorized: false
  }
});

// DB 연결 성공 시 로그 출력
pool.on('connect', () => {
  console.log('🟢 [DB Connection] Supabase PostgreSQL 데이터베이스에 성공적으로 연결되었습니다.');
});

// DB 연결 에러 발생 시 로그 출력
pool.on('error', (err) => {
  console.error('🔴 [DB Error] 데이터베이스 연결 중 오류 발생:', err);
});

// 다른 파일에서 DB 쿼리를 실행할 수 있도록 pool 객체를 모듈로 내보냅니다.
module.exports = pool;