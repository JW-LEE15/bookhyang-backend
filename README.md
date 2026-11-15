# 🛠️ 북향 (bookhyang) - Backend Server

> **북향(bookhyang) 모바일 앱을 위한 Node.js & Supabase 백엔드 API 서버**

---

## 🛠️ Tech Stack & Structure

- **Runtime**: Node.js (22 이상 25 미만), Express 5
- **Database**: Supabase (PostgreSQL), `pg`로 직접 연결
- **인증**: JWT(HS256, 만료 7일) + bcrypt 비밀번호 해시
- **횟수 제한**: express-rate-limit (서버 메모리 카운터)
- **External API**: Kakao Book Search API (도서 검색, 소개글), Google Gemini API (AI 추천·댓글 요약·독서 리포트)
- **그 밖의 라이브러리**: axios, cors, dotenv, csv-parse (수집·import 스크립트용). `es-hangul`은 의존성에 있지만 현재 코드에서는 쓰지 않습니다.

### 📁 Project Structure
- `app.js`: Express 서버 메인 엔트리포인트 (라우터 마운트, CORS, trust proxy 설정)
- `db.js`: PostgreSQL(Supabase)에 `pg`로 직접 연결하는 설정
- `config/`: `auth.js` (JWT 발급·검증), `trustProxy.js` (`TRUST_PROXY_HOPS` 해석)
- `routes/`: API 라우터
  - `books.js`: 도서 검색, 모음집 목록·상세·소개글·관련 책
  - `userBooks.js`: 내 서재 도서 목록·담기·삭제·독서 상태 변경
  - `readingRecords.js`: 독서 기록 요약, 완독일 수정, 책별 메모
  - `auth.js`: 회원가입, 로그인, 닉네임 수정
  - `profileImage.js`: 내 프로필 사진 올리기·지우기
  - `users.js`: 프로필 사진 조회 (공개)
  - `comments.js`: 책별 댓글, 답글, 숨김, 삭제, 하트, 신고
  - `ai.js`: AI 추천, 댓글 요약, 독서 리포트 생성
  - `readingReports.js`: 저장된 AI 독서 리포트 목록·삭제
- `middleware/`: 인증과 횟수 제한 (`requireAuth.js`, `optionalAuth.js`, `rateLimiters.js`, `nicknameLimiter.js`, `profileImageLimiter.js`, `bookLimiters.js`, `commentLimiters.js`, `aiLimiters.js`)
- `validators/`: 요청 검증 (`authValidator.js`, `bookValidator.js`, `commentValidator.js`, `readingValidator.js`, `profileImageValidator.js`, `aiValidator.js`)
- `services/`: 비즈니스 로직
  - `kakaoBook.js`, `kakaoDescription.js`: 카카오 도서 검색, 책 소개글
  - `booksCatalog.js`, `isbn.js`: 모음집 조회, ISBN 처리
  - `comments.js`, `commentSummary.js`: 댓글 로직, AI 댓글 요약
  - `readingRecords.js`, `readingReport.js`, `readingReportStore.js`, `kstDate.js`: 독서 기록, AI 독서 리포트 생성·저장, 한국 시간 기간 계산
  - `recommendation.js`: AI 독서 추천
  - `profileImage.js`, `safeError.js`: 프로필 사진 처리, 로그용 오류 요약
  - `ai/`: 공통 AI 모듈 (`index.js`, `geminiProvider.js`, `usageGuard.js`, `cache.js`, `errors.js`)
- `sql/`: Supabase SQL Editor에서 직접 실행하는 SQL (적용·롤백 쌍)
- `scripts/`: 모음집 책 수집·import 스크립트와 수동 확인용 스크립트. 사용법은 [scripts/README.md](scripts/README.md)를 참고합니다.
- `test/`: `node --test` 테스트

---

## 📋 주요 API 엔드포인트

공통: 성공은 `{ success: true, ... }`, 실패는 `{ success: false, message, code? }`입니다. 인증이 필요한 API는 `Authorization: Bearer <토큰>` 헤더를 보냅니다. 횟수 제한에 걸리면 429 `RATE_LIMITED`로 응답합니다.

### 🔐 인증·프로필

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| POST | `/api/auth/signup` | 없음 | IP당 1시간 10회 | 회원가입 (이메일, 비밀번호 8자 이상, 닉네임 2~20자) |
| POST | `/api/auth/login` | 없음 | IP당 15분 10회 (실패한 시도만 셈) | 로그인, 토큰 발급 |
| PATCH | `/api/auth/nickname` | 필요 | 사용자당 1시간 10회 | 닉네임 수정 |
| PUT | `/api/auth/profile-image` | 필요 | 사용자당 1시간 20회 (올리기·지우기 합산) | 프로필 사진 올리기 (`{ image: '<base64>' }`, JPEG/PNG, 최대 100KB) |
| DELETE | `/api/auth/profile-image` | 필요 | 위와 같은 카운터 | 프로필 사진 지우기 (사진이 없어도 200) |
| GET | `/api/users/:id/profile-image` | 없음 (공개) | 없음 | 프로필 사진 보기. 없거나 id가 잘못되었거나 사용자가 없으면 똑같이 404 |

### 📚 도서 (모두 공개)

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| GET | `/api/books/search` | 없음 | 없음 | 카카오 도서 검색 (민음사 도서만 남김, 응답에 `documents`와 `books`) |
| GET | `/api/books` | 없음 | 없음 | 모음집 목록 (`category`: 소설·시·에세이, `sort`: title·latest, `page`, `limit` 기본 30 최대 50) |
| GET | `/api/books/:id/description` | 없음 | IP당 1분 60회 | 책 소개글. DB의 ISBN으로 카카오를 호출하고, 못 가져오면 `description: null` |
| GET | `/api/books/:id/related` | 없음 | 없음 | 관련 책 (같은 분야 또는 같은 작가, 최대 10권) |
| GET | `/api/books/:id` | 없음 | 없음 | 도서 상세 |

### 📖 내 서재·독서 기록 (모두 로그인 필요)

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| GET | `/api/user-books` | 필요 | 없음 | 내 서재 도서 목록 |
| POST | `/api/user-books` | 필요 | 없음 | 서재에 담기 (`WISH`, `READING`, `COMPLETED`, 생략하면 `READING`). 같은 ISBN 중복은 막음 |
| DELETE | `/api/user-books/:id` | 필요 | 없음 | 서재에서 삭제 (본인 도서만, 남의 도서·없는 도서는 404) |
| PATCH | `/api/user-books/:id/status` | 필요 | 없음 | 독서 상태 변경. 완독으로 바꾸면 완독일에 오늘(한국 시간)을 넣고, 다른 상태로 바꾸면 완독일을 지움 |
| GET | `/api/user-books/summary` | 필요 | 없음 | MY 화면용 독서 기록 요약 (`recent` 기본 5, 최대 10) |
| PATCH | `/api/user-books/:id/read-end-date` | 필요 | 없음 | 완독일 수정 (완독 상태인 도서만, 아니면 409 `NOT_COMPLETED`) |
| GET | `/api/user-books/:id/note` | 필요 | 없음 | 책별 개인 메모 조회 (메모가 없으면 `data: null`) |
| PUT | `/api/user-books/:id/note` | 필요 | 없음 | 메모 작성·수정 (1~2000자). 메모는 항상 비공개 |
| DELETE | `/api/user-books/:id/note` | 필요 | 없음 | 메모 삭제 (메모가 없으면 404 `NOTE_NOT_FOUND`) |

### 💬 댓글 (책은 ISBN13으로 구분)

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| GET | `/api/comments` | 선택 | 없음 | 책별 원댓글 목록 (`isbn`, `limit` 기본 20 최대 50, `before` 커서, 최신순). 로그인하면 내 댓글·내 하트·내 숨김 댓글 원문이 보임 |
| GET | `/api/comments/:id/replies` | 선택 | 없음 | 원댓글의 답글 목록 |
| POST | `/api/comments` | 필요 | 없음 | 댓글·답글 작성 (1~500자). 답글은 한 단계만, 원댓글과 같은 책만 가능 |
| PATCH | `/api/comments/:id/hidden` | 필요 | 없음 | 내 댓글 숨기기·해제 (`{ is_hidden }`) |
| DELETE | `/api/comments/:id` | 필요 | 없음 | 내 댓글 삭제. 답글이 달린 원댓글은 「삭제된 댓글입니다」로 남음 |
| PUT | `/api/comments/:id/like` | 필요 | 사용자당 1분 30회 (PUT·DELETE 합산) | 하트 누르기 (멱등, 본인 댓글은 400 `LIKE_OWN_COMMENT`) |
| DELETE | `/api/comments/:id/like` | 필요 | 위와 같은 카운터 | 하트 취소 (멱등) |
| POST | `/api/comments/:id/report` | 필요 | 사용자당 1시간 10회 | 댓글 신고 (`reason`: spam·abuse·spoiler·other, `detail` 200자 이하). 저장만 하고 자동 숨김·삭제는 없음. 본인 댓글 400, 중복 409 `ALREADY_REPORTED` |

### 🤖 AI (모두 로그인 필요)

세 API는 같은 사용자별 횟수 제한을 공유합니다. 사용자당 1분 5회와 24시간 50회입니다.
처리 순서는 인증(401), 사용자별 횟수 제한(429), 입력 검증(400), AI 사용 가능 확인(503 `AI_UNAVAILABLE` 또는 `AI_BUSY`), 처리입니다.

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| POST | `/api/ai/recommend` | 필요 | 사용자당 1분 5회 + 24시간 50회 | 독서 추천. 분야·주제·분위기를 보내면 모음집 후보 중에서 최대 3권을 추천하고, 후보가 3권 미만이면 AI를 부르지 않고 422로 응답 |
| POST | `/api/ai/comment-summary` | 필요 | 위와 같음 | 책 댓글 AI 요약 (`isbn`, `includeSpoilers?`, `refresh?`). 댓글이 5개 미만이면 422 `NOT_ENOUGH_COMMENTS` |
| POST | `/api/ai/reading-report` | 필요 | 위와 같음 | AI 독서 리포트 생성·저장 (`period`: `this_month`·`last_month`, `includeNotes?`). 기간 안 완독이 2권 미만이면 422 `NOT_ENOUGH_RECORDS` |

### 🗂️ 저장된 독서 리포트 (모두 로그인 필요)

| 메서드 | 경로 | 인증 | 횟수 제한 | 설명 |
|---|---|---|---|---|
| GET | `/api/reading-reports` | 필요 | 없음 | 내 리포트 목록 (최신 20개, 본문 포함) |
| DELETE | `/api/reading-reports/:id` | 필요 | 없음 | 내 리포트 삭제 (남의 리포트·없는 리포트·잘못된 id는 똑같이 404) |

> 그 밖에 `GET /`는 서버 실행 상태를 알려 주는 문구를 돌려줍니다. 없는 경로는 404 JSON으로 응답합니다.

---

## ⚙️ 실행 방법 (Getting Started)

1. 환경변수 설정: `.env.example` 파일을 복사하여 `.env` 파일을 생성하고 아래 [환경변수](#-환경변수) 표의 필수 값을 입력합니다. `.env`는 깃에 올리지 않습니다.
2. 의존성 설치 및 실행:
```bash
npm install
npm start      # node app.js
npm run dev    # nodemon app.js (개발용)
```
3. 테스트:
```bash
npm test       # node --test "test/**/*.test.js"
```

서버는 `JWT_SECRET`이 없거나 32자 미만이면, `TRUST_PROXY_HOPS`가 잘못된 값이면 시작하지 않습니다.
`GEMINI_API_KEY`나 `AI_MODEL`이 없어도 서버는 시작하고, AI 라우트만 503 `AI_UNAVAILABLE`로 응답합니다.

---

## 🔑 환경변수

이름과 용도만 적습니다. 값은 `.env`에만 두고 깃에 올리지 않습니다. `.env.example`에는 값을 비운 채 대부분의 이름이 적혀 있습니다.

| 이름 | 필수 | 용도 |
|---|---|---|
| `DATABASE_URL` | 필수 | PostgreSQL(Supabase) 연결 URL |
| `JWT_SECRET` | 필수 | 로그인 토큰 서명용 비밀값 (32자 이상) |
| `KAKAO_API_KEY` | 도서 검색·소개글에 필요 | 카카오 REST API 키 |
| `KAKAO_REST_API_KEY` | 선택 | 설정하면 `KAKAO_API_KEY`보다 먼저 쓰는 같은 용도의 이름 (검색·소개글·수집 스크립트 모두 동일). `.env.example`에는 없음 |
| `PORT` | 선택 | 서버 포트 (비우면 5000, Render는 자동 제공) |
| `TRUST_PROXY_HOPS` | 선택 | 앞단 프록시(Render 등) 단계 수 (0~10의 정수). IP 기준 횟수 제한이 실제 사용자 IP를 보게 함. 비우거나 0이면 설정하지 않음 |
| `GEMINI_API_KEY` | AI 사용 시 필요 | Gemini API 키 |
| `AI_MODEL` | AI 사용 시 필요 | 기본 모델 이름 |
| `AI_FALLBACK_MODEL` | 선택 | 대체 모델 이름. 비우면 대체 없음 |
| `AI_THINKING_LEVEL` | 선택 | 생각 수준 (minimal, low, medium, high). 설정하지 않으면 minimal, 값을 비워 두면 생각 설정을 보내지 않음 |
| `AI_TIMEOUT_MS` | 선택 | 기본 호출과 대체 호출을 합친 전체 시간 예산(밀리초) |
| `AI_DAILY_LIMIT` | 선택 | 서버 전체 하루 AI 호출 한도 (기본 500, 이 값의 90%에 닿으면 `AI_BUSY`) |
| `AI_CANDIDATE_LIMIT` | 선택 | 추천 후보 책 개수 상한 (1~20). 후보 부족 확인용 테스트 값이며 운영에서는 설정하지 않음 |

---

## 🗄️ SQL 폴더와 적용 순서

`sql/`의 파일은 Supabase SQL Editor에서 직접 실행합니다. (기록용 파일이며 자동으로 적용되지 않습니다.)
**적용 순서는 SQL 먼저, 그다음 코드 배포입니다.** 롤백은 반대로 **코드를 먼저 되돌린 뒤 SQL을 실행**합니다. 새 코드가 없는 컬럼·테이블을 읽으면 500 오류가 나기 때문입니다.

파일은 모두 22개입니다. (적용 9개, 롤백 9개, RLS 해제 4개)

| 적용 파일 | 롤백 파일 | RLS 해제 파일 | 내용 |
|---|---|---|---|
| `20261105_books_category_description.sql` | `20261105_books_category_description_rollback.sql` | - | books에 category, description 컬럼 추가, author·translator 길이 확장 |
| `20261105_books_isbn13_check.sql` | `20261105_books_isbn13_check_rollback.sql` | - | ISBN13 형식 CHECK (따로 적용 가능) |
| `20261109_comments.sql` | `20261109_comments_rollback.sql` | `20261109_comments_disable_rls.sql` | comments 테이블 |
| `20261111_reading_notes.sql` | `20261111_reading_notes_rollback.sql` | `20261111_reading_notes_disable_rls.sql` | reading_notes 테이블 (책별 개인 메모) |
| `20261112_comments_extend.sql` | `20261112_comments_extend_rollback.sql` | - | 대댓글(한 단계), 스포일러, 숨김, 삭제 표시 |
| `20261114_comment_likes.sql` | `20261114_comment_likes_rollback.sql` | `20261114_comment_likes_reports_disable_rls.sql` (comment_reports와 공용) | comment_likes 테이블 (댓글 하트) |
| `20261114_comment_reports.sql` | `20261114_comment_reports_rollback.sql` | `20261114_comment_likes_reports_disable_rls.sql` (comment_likes와 공용) | comment_reports 테이블 (댓글 신고) |
| `20261114_reading_reports.sql` | `20261114_reading_reports_rollback.sql` | `20261114_reading_reports_disable_rls.sql` | reading_reports 테이블 (AI 독서 리포트 저장) |
| `20261114_users_profile_image.sql` | `20261114_users_profile_image_rollback.sql` | - | users에 프로필 사진 컬럼 3개 추가 (`profile_image` bytea, `profile_image_type`, `profile_image_updated_at`) |

- 파일 이름의 날짜 순서대로 적용합니다. `20261112_comments_extend.sql`은 comments가 먼저 있어야 하고, 하트·신고 테이블은 comments를 참조합니다.
- 롤백하면 해당 테이블이나 컬럼의 데이터가 삭제됩니다. (예: 하트, 신고, 메모, 리포트, 프로필 사진) 각 롤백 파일 맨 위의 주의 문구를 먼저 읽습니다.
- 책 수집·import 스크립트와 관련된 SQL 적용 방법은 [scripts/README.md](scripts/README.md)에 있습니다.

---

## 🔒 보안·정책

- **인증**: 비밀번호는 bcrypt로 해시해 저장하고, 로그인 토큰은 JWT(HS256, 7일)입니다. 없는 이메일로 로그인할 때도 비교 시간을 맞추기 위해 더미 해시를 비교합니다. 모든 로그인 실패는 같은 메시지로 응답합니다.
- **횟수 제한(express-rate-limit)**: 아래 9개가 있습니다. 인증이 필요한 API는 인증 다음에 횟수 제한을 적용합니다.

| 횟수 제한 | 기준 | 한도 | 적용 API |
|---|---|---|---|
| 회원가입 | IP | 1시간 10회 | `POST /api/auth/signup` |
| 로그인 | IP | 15분 10회 (성공한 요청은 세지 않음) | `POST /api/auth/login` |
| 닉네임 수정 | 사용자 | 1시간 10회 | `PATCH /api/auth/nickname` |
| 프로필 사진 | 사용자 | 1시간 20회 (올리기·지우기 합산) | `PUT·DELETE /api/auth/profile-image` |
| 책 소개글 | IP | 1분 60회 | `GET /api/books/:id/description` |
| 댓글 하트 | 사용자 | 1분 30회 (PUT·DELETE 합산) | `PUT·DELETE /api/comments/:id/like` |
| 댓글 신고 | 사용자 | 1시간 10회 | `POST /api/comments/:id/report` |
| AI (분당) | 사용자 | 1분 5회 | `POST /api/ai/*` 3개 |
| AI (일일) | 사용자 | 24시간 50회 (첫 요청 시각부터) | `POST /api/ai/*` 3개 |

- **소유자 확인**: 서재, 메모, 댓글, 리포트를 바꾸거나 지우는 쿼리에는 모두 `user_id` 조건이 들어갑니다. 남의 데이터, 없는 데이터, 잘못된 id는 똑같이 404로 응답해서 존재 여부를 알려 주지 않습니다.
- **RLS(Row Level Security)**
  - comments, reading_notes, comment_likes, comment_reports, reading_reports는 SQL 파일에서 RLS를 켜고 정책은 만들지 않았습니다. 백엔드는 DB 소유자 역할로 접속해 RLS를 우회하므로, 실제 접근 통제는 위의 소유자 확인(`user_id` 조건)이 합니다.
  - users, user_books, books도 **운영 DB(Supabase) 기준**으로 RLS를 켰습니다. 이 SQL은 아직 레포에 없습니다. 코드로는 확인할 수 없는 부분입니다.
  - 적용 후 백엔드에서 문제가 있을 때 쓰는 `*_disable_rls.sql`이 있습니다. (위 SQL 표 참고)
- **로그에 남기지 않는 것**: AI 프롬프트·모델 응답, 댓글 원문, 신고 상세와 신고자, 메모 원문, 프로필 사진 데이터, 토큰, 사용자 id, IP는 로그에 남기지 않습니다. 오류 로그에는 오류 이름과 DB 오류 코드 같은 짧은 정보만 남깁니다. (단, 도서 검색어는 예외입니다. [한계](#-한계와-향후-계획) 참고)
- **책 소개글**: 서버에 저장하지도 캐시하지도 않습니다. 호출할 때마다 DB의 ISBN으로 카카오에서 가져오고, 클라이언트가 보낸 ISBN은 쓰지 않습니다.
- **프로필 사진**: JPEG/PNG만 허용하고 서버가 파일 형식을 직접 판정합니다. 최대 100KB이고 users 테이블에 저장합니다. 사진이 바뀌면 URL의 `?v=`가 바뀌어 캐시가 갱신됩니다.
- **AI 안전장치**
  - 사용자가 쓴 글(댓글, 책 제목, 메모)은 데이터 블록 안의 문자열로만 넣고, 모델이 돌려준 근거가 입력에 없으면 버립니다. 닉네임과 user_id는 AI에 보내지 않습니다.
  - 공통 AI 모듈(`services/ai/`)은 기본 모델이 404·503·429로 실패하면 대체 모델(`AI_FALLBACK_MODEL`)을 요청당 한 번만 시도합니다. 시간 초과와 네트워크 오류는 대체하지 않습니다.
  - 서버 전체 하루 호출 한도(`AI_DAILY_LIMIT`, 기본 500)의 90%에 닿으면 `AI_BUSY`로 응답합니다. 대체 호출도 셉니다. 하루의 기준은 태평양시이고, 카운터는 서버 메모리에 있습니다.
  - 캐시: 추천은 같은 사용자의 같은 요청을 20초, 댓글 요약은 같은 입력을 20분 재사용합니다. (서버 메모리, 요약은 `refresh`로 다시 만들 수 있음)
  - 독서 리포트의 `includeNotes`는 앱이 보내는 "AI 데이터 사용 동의" 상태이며 서버가 동의를 검증하지는 못합니다. `true`일 때만 메모를 조회해 AI에 보냅니다.
- **오류 응답**: 예상하지 못한 오류는 내부 내용 없이 일반 메시지로 응답합니다.

---

## ⚠️ 한계와 향후 계획

### 현재 한계
- **횟수 제한이 서버 메모리 기반**입니다. 서버를 재시작하면 카운터가 초기화되고, 서버 1대를 기준으로 한 구성입니다. 서버를 여러 대로 늘리면 대수만큼 한도가 늘어납니다. AI 서버 일일 한도와 AI 캐시도 같은 방식입니다.
- **CORS가 `origin: '*'`**입니다. 개발 단계 설정이며, 배포 시 도메인을 제한할 수 있습니다.
- **도서 검색어가 서버 로그에 남습니다.** `GET /api/books/search`는 검색어를 로그로 출력합니다. AI·댓글·메모·사진의 원문을 로그에 남기지 않는 것과 다릅니다.
- **IP 기준 횟수 제한**은 배포 환경에서 `TRUST_PROXY_HOPS`가 실제 프록시 단계 수와 맞아야 실제 사용자 IP로 셉니다.
- **프로필 사진은 DB(users 테이블 bytea)에 저장**하며 최대 100KB입니다.
- **신고는 저장만** 합니다. 자동 숨김·삭제나 처리 기능은 없습니다.
- **독서 리포트 기간은 이번 달과 지난 달뿐**입니다.
- 서재·메모·리포트 API에는 횟수 제한이 없습니다. (AI 생성 API에만 있음)
- users, user_books, books의 RLS 설정은 운영 DB에서 적용한 것이며 레포에 SQL이 없습니다.

### 향후 계획
- 직접 기간 지정 AI 독서 리포트
- 댓글 수정, 댓글 인기순 정렬
- 신고 처리 화면 (관리 기능)
- 프로필 이미지를 Storage로 전환
- 모음집 초성 이동 (한글 초성 기준으로 목록 위치 이동. 현재 구현되어 있지 않음)
- 책 소개글 길이 제한 (카카오 소개글 길이를 서버에서 제한)
