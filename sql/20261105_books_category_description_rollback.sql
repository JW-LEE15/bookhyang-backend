-- 20261105_books_category_description.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 주의: 컬럼을 지우면 채워 둔 category, description 값이 사라지고 되돌릴 수 없음
-- books_isbn_key는 원래 있던 제약이라 지우지 않음
-- ISBN13 CHECK 롤백은 20261105_books_isbn13_check_rollback.sql
-- import로 넣은 행은 import 스크립트가 남긴 import_inserted_*.txt의 SQL로 따로 지움
--   (user_books가 참조하는 책은 남기고 참조되지 않는 책만 지우는 방식)

-- author/translator를 varchar(100)으로 되돌리기 전에 100자를 넘는 값이 있는지 확인 (0행이어야 함)
-- 넘는 값이 있으면 아래 ALTER가 오류로 멈추고, 트랜잭션 전체가 적용되지 않음
-- SELECT id, length(author) AS author_len, length(translator) AS translator_len
--   FROM public.books
--  WHERE length(author) > 100 OR length(translator) > 100;

BEGIN;

DROP INDEX IF EXISTS public.books_title_idx;
DROP INDEX IF EXISTS public.books_category_title_idx;
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_category_check;
ALTER TABLE public.books DROP COLUMN IF EXISTS description;
ALTER TABLE public.books DROP COLUMN IF EXISTS category;
ALTER TABLE public.books ALTER COLUMN translator TYPE varchar(100);
ALTER TABLE public.books ALTER COLUMN author     TYPE varchar(100);

COMMIT;
