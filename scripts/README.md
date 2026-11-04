# 모음집용 books 수집·import 스크립트

> **주의**
> - 수집 결과(CSV, 보고서)는 **레포 밖** `C:\bookhyang-workspace\bookhyang-data\kakao\`에 저장됩니다.
> - **카카오 약관 확인 전에는 수집한 CSV와 스크립트 출력을 깃에 올리지 마세요.** 레포 안으로 복사하지 말고, `--out`으로 레포 안 폴더를 지정하지 마세요.
>   (보조로 `.gitignore`에 `/data/`, `/scripts/output/`이 들어 있지만, 그 밖의 경로는 막지 않습니다.)

Windows PowerShell 기준입니다.

## 파일

| 파일 | 역할 |
|---|---|
| `scripts\collect-minumsa-books.js` | 카카오 도서 검색에서 민음사 책을 모아 CSV로 저장 (DB 접속 없음) |
| `scripts\import-books-csv.js` | 분야를 채운 CSV를 books 테이블에 ISBN 기준으로 upsert |
| `scripts\lib\bookData.js` | 공용 함수 (출력 경로, ISBN13 검사, CSV 쓰기) |
| `sql\20261105_books_category_description.sql` (+ `_rollback.sql`) | category/description 추가, author·translator 길이 확장 |
| `sql\20261105_books_isbn13_check.sql` (+ `_rollback.sql`) | ISBN13 형식 CHECK (따로 적용) |

## 공통

- 실행 위치: `cd C:\bookhyang-workspace\bookhyang-backend`
- 두 스크립트 모두 실행 위치와 상관없이 `bookhyang-backend\.env`를 읽습니다.
  - 수집: `KAKAO_REST_API_KEY` (없으면 `KAKAO_API_KEY`)
  - import: `DATABASE_URL` (`db.js`)
- 출력 폴더 기본값: `C:\bookhyang-workspace\bookhyang-data\kakao\` (없으면 자동 생성)
- 파일 이름의 `<시각>`: 실행한 PC의 현지 시각, `YYYYMMDD-HHmmss` (예: `20261105-143005`)
- CSV 형식: UTF-8 BOM, 모든 칸을 따옴표로 감쌈, 줄바꿈 CRLF
- 옵션 값에 공백이 있으면 따옴표로 감쌉니다. 예: `--out "D:\my data"`

## 1. 수집: collect-minumsa-books.js

카카오 `target=publisher`, `query=민음사`로 `sort=accuracy`, `sort=latest` 두 정렬을 각각 페이지를 넘기며 받습니다.
출판사가 정확히 `민음사`인 책만 남기고, ISBN13 기준으로 중복을 합칩니다. DB에는 접속하지 않습니다.

```powershell
node scripts\collect-minumsa-books.js
node scripts\collect-minumsa-books.js --no-cover --no-description
node scripts\collect-minumsa-books.js --out C:\bookhyang-workspace\bookhyang-data\kakao --delay 500
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--out <폴더>` | `C:\bookhyang-workspace\bookhyang-data\kakao` | 출력 폴더 |
| `--no-cover` | 끔 (표지 저장) | cover_image 칸을 비움 (열은 남음) |
| `--no-description` | 끔 (소개글 저장) | description 칸을 비움 (열은 남음) |
| `--delay <ms>` | 300 | 요청 사이 대기 시간 (숫자로 입력) |

### 출력 파일

| 파일 | 열 / 내용 |
|---|---|
| `books_collected_<시각>.csv` | `isbn13, title, author, translator, published_date, cover_image, description, category, kakao_status` |
| `excluded_<시각>.csv` | `reason, kakao_publisher, title, authors, isbn_raw, datetime` |
| `report_<시각>.txt` | 수집 보고서 |

- `books_collected`: category는 빈칸, published_date는 `YYYY-MM-DD`, 제목 가나다순
- `excluded`의 reason: `출판사 불일치`, `ISBN13 없음`, `ISBN13 체크섬 오류`, `제목 없음`, `저자 없음`
- `report`: 요청 횟수와 걸린 시간, 카카오 meta(total_count, pageable_count, 받은 건수), 실패한 페이지, 제외 사유별 건수, 최종 수집 건수, 제외한 출판사 이름별 건수
- 한 번에 받을 수 있는 양은 카카오가 주는 `pageable_count`까지입니다. `total_count`가 그보다 크면 받지 못한 책이 있습니다.

### 중단과 재시도

- 카카오 키가 없거나, 카카오가 400/401/403을 돌려주면 중단합니다.
- 429, 5xx, 네트워크 오류는 1초 → 2초 → 4초 간격으로 재시도합니다. 그래도 실패하면 그 페이지는 건너뛰고 보고서에 남깁니다.

## 2. import: import-books-csv.js

**먼저 할 일:** Supabase SQL Editor에서 `sql\20261105_books_category_description.sql`을 실행합니다.
실행하지 않았으면 스크립트가 "SQL 먼저 실행"이라고 안내하고 멈춥니다.

```powershell
node scripts\import-books-csv.js C:\bookhyang-workspace\bookhyang-data\kakao\demo_categorized.csv --dry-run
node scripts\import-books-csv.js C:\bookhyang-workspace\bookhyang-data\kakao\demo_categorized.csv
node scripts\import-books-csv.js <csv경로> --allow-partial
```

| 인자 / 옵션 | 기본값 | 설명 |
|---|---|---|
| `<csv경로>` (첫 번째 인자) | 필수 | 넣을 CSV |
| `--dry-run` | 끔 | 검증하고 DB에서 신규/기존 건수만 **조회**. DB에 쓰지 않음 |
| `--allow-partial` | 끔 | 실패 행이 있어도 통과한 행만 넣음. 끄면 실패가 하나라도 있을 때 아무것도 넣지 않음 |
| `--out <폴더>` | `C:\bookhyang-workspace\bookhyang-data\kakao` | 보고 파일 폴더 |

### 입력 CSV

- 필수 열: `isbn13, title, author`
- 선택 열: `translator, published_date, cover_image, description, category`
- 머리글은 대소문자와 앞뒤 공백을 구분하지 않고, 그 밖의 열(kakao_status 등)은 무시합니다.
- category: 빈칸, `소설`, `시`, `에세이` 중 하나
- published_date: `YYYY-MM-DD` (`YYYY/MM/DD`, `YYYY.MM.DD`도 허용)
- 빈칸은 NULL로 처리합니다.
- 길이 제한(title 255, author·translator 500, isbn 20)은 실행할 때 DB에서 읽어서 검사합니다.

### 이미 있는 책(같은 ISBN)

- 비어 있는 칸만 채우고 기존 값은 덮어쓰지 않습니다.
- category는 CSV에 값이 있을 때만 바뀝니다. **빈칸으로는 기존 분류가 지워지지 않습니다.**
- 분류를 미분류로 되돌리려면 SQL로 직접 `UPDATE ... SET category = NULL`을 실행합니다.

### 출력 파일

| 파일 | 언제 생기나 | 열 / 내용 |
|---|---|---|
| `import_failed_<시각>.csv` | 실패 행이 있을 때 (dry-run 포함) | `row, isbn13, title, reason`. row는 Excel 시트의 행 번호(머리글이 1행) |
| `import_inserted_<시각>.txt` | 실제 반영에 성공했을 때 | 새로 넣은 books.id 목록과 되돌리기 SQL |

- 실제 반영은 트랜잭션 하나로 합니다. 중간에 오류가 나면 전체를 롤백해서 DB는 바뀌지 않습니다.
- 실패나 중단이 있으면 종료 코드 1로 끝납니다.

## 3. 실행 순서

1. **(Supabase) SQL 적용**: `sql\20261105_books_category_description.sql`
   - 실행 전 백업 권장: `CREATE TABLE public.books_backup_20261105 AS SELECT * FROM public.books;`
   - ISBN13 CHECK(`sql\20261105_books_isbn13_check.sql`)는 원할 때 따로 실행
2. **수집**
   ```powershell
   node scripts\collect-minumsa-books.js
   ```
3. **확인**: `report_<시각>.txt`에서 건수, pageable_count, 제외한 출판사를 봅니다. CSV는 맨 위 몇 줄만 확인합니다.
   ```powershell
   Get-Content C:\bookhyang-workspace\bookhyang-data\kakao\books_collected_<시각>.csv -TotalCount 5 -Encoding UTF8
   ```
4. **분야 채우기**: 시연할 40~60권을 `demo_categorized.csv`로 복사하고 category를 채웁니다.
   - Excel: `데이터 > 텍스트/CSV 가져오기`로 열고 **isbn13 열을 텍스트로** 지정합니다. 그냥 열면 `9.79E+12`처럼 바뀝니다.
   - 저장: **CSV UTF-8(쉼표로 분리)**
5. **dry-run**
   ```powershell
   node scripts\import-books-csv.js C:\bookhyang-workspace\bookhyang-data\kakao\demo_categorized.csv --dry-run
   ```
   통과/실패 행 수와 신규/기존/분류 변경 예상 건수를 봅니다. 실패가 있으면 `import_failed_*.csv`를 보고 고친 뒤 다시 dry-run합니다.
6. **import**
   ```powershell
   node scripts\import-books-csv.js C:\bookhyang-workspace\bookhyang-data\kakao\demo_categorized.csv
   ```
7. **(선택) 나머지 전체**: `books_collected_<시각>.csv`를 같은 방법(dry-run → import)으로 넣습니다. category가 빈칸이라 미분류로 들어가고, 6번에서 넣은 분류는 지워지지 않습니다.

## 되돌리기

- `import_inserted_<시각>.txt`에 적힌 SQL을 사용합니다. 확인 SELECT를 먼저 실행하고, 그다음 DELETE를 실행합니다.
- `user_books_book_id_fkey`가 `ON DELETE CASCADE`이므로 **user_books가 참조하는 책은 남기고, 참조되지 않는 책만 지웁니다.**
- 이미 있던 책에 채운 값은 이 방법으로 되돌려지지 않습니다. 백업 테이블에서 복구합니다.
