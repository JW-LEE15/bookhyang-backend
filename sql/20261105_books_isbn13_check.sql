-- books.isbn: ISBN13 형식(978/979로 시작하는 13자리 숫자) CHECK 제약
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일). 다른 변경과 따로 적용 가능
-- 롤백: 20261105_books_isbn13_check_rollback.sql
-- isbn은 NULL 허용 컬럼이고, NULL은 이 CHECK를 통과함 (NULL을 막으려면 NOT NULL을 따로 정해야 함)
-- 체크섬까지는 검사하지 않음 (import 스크립트에서 검사)

-- 적용 전 위반 행 확인 (0행이어야 함. 데미안 id=2는 9788937460449로 통과)
-- SELECT id, title, isbn FROM public.books WHERE isbn !~ '^97[89][0-9]{10}$';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'books_isbn13_check'
      AND conrelid = 'public.books'::regclass
  ) THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_isbn13_check
      CHECK (isbn ~ '^97[89][0-9]{10}$');
  END IF;
END $$;

COMMIT;
