-- books: 모음집용 category, description 컬럼 추가, author/translator 길이 확장
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261105_books_category_description_rollback.sql
-- ISBN13 형식 CHECK는 따로 적용할 수 있게 20261105_books_isbn13_check.sql에 분리
-- 시퀀스: books_id_seq last_value=2, is_called=true, max(id)=2 확인 → 다음 id가 3이라 setval 불필요

-- (권장) 실행 전 백업
-- CREATE TABLE public.books_backup_20261105 AS SELECT * FROM public.books;

BEGIN;

ALTER TABLE public.books ADD COLUMN IF NOT EXISTS category    varchar(10);
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS description text;
-- cover_image는 이미 nullable(text)이라 변경 없음

-- author, translator: varchar(100) → varchar(500). 길이 제한만 늘리는 변경이라 기존 데이터는 그대로
-- NOT NULL 여부는 바뀌지 않음 (author는 NOT NULL, translator는 NULL 허용 유지)
ALTER TABLE public.books ALTER COLUMN author     TYPE varchar(500);
ALTER TABLE public.books ALTER COLUMN translator TYPE varchar(500);

-- category: NULL(미분류) 또는 '소설', '시', '에세이'만 허용. 빈 문자열 ''은 거부
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'books_category_check'
      AND conrelid = 'public.books'::regclass
  ) THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_category_check
      CHECK (category IS NULL OR category IN ('소설', '시', '에세이'));
  END IF;
END $$;

-- isbn UNIQUE: isbn 한 컬럼짜리 unique 인덱스가 이미 있으면 건너뜀 (현재 books_isbn_key 존재)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.books'::regclass
      AND i.indisunique
      AND i.indnatts = 1
      AND a.attname = 'isbn'
  ) THEN
    ALTER TABLE public.books ADD CONSTRAINT books_isbn_key UNIQUE (isbn);
  END IF;
END $$;

-- 모음집 목록 조회용 인덱스
CREATE INDEX IF NOT EXISTS books_category_title_idx ON public.books (category, title, id);
CREATE INDEX IF NOT EXISTS books_title_idx          ON public.books (title, id);

COMMIT;
