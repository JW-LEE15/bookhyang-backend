# 🛠️ 북향 (bookhyang) - Backend Server

> **북향(bookhyang) 모바일 앱을 위한 Node.js & Supabase 백엔드 API 서버**

---

## 🛠️ Tech Stack & Structure

- **Runtime**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **External API**: Kakao Book Search API

### 📁 Project Structure
- `routes/books.js`: 도서 검색 API 라우터
- `routes/userBooks.js`: 사용자 서재 도서 CRUD API 라우터
- `services/kakaoBook.js`: 카카오 도서 검색 API 연동 서비스
- `app.js`: Express 서버 메인 엔트리포인트
- `db.js`: Supabase DB 클라이언트 연결 설정

---

## 📋 주요 API 엔드포인트

- `GET /api/books/search`: 카카오 API 키워드/ISBN 도서 검색
- `GET /api/user-books`: 사용자 서재 도서 목록 조회
- `POST /api/user-books`: 서재 도서 신규 등록 (`WISH`, `READING`, `COMPLETED`)
- `PATCH /api/user-books/:id`: 독서 상태(`status`) 업데이트
- `DELETE /api/user-books/:id`: 서재 도서 삭제

---

## ⚙️ 실행 방법 (Getting Started)

1. 환경변수 설정: `.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 API Key 및 Supabase 설정값을 입력합니다.
2. 의존성 설치 및 실행:
```bash
npm install
npm start