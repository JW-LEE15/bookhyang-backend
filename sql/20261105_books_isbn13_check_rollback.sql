-- 20261105_books_isbn13_check.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)

BEGIN;

ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_isbn13_check;

COMMIT;
