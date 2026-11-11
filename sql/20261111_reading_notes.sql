-- reading_notes: 책(user_books 행) 하나에 개인 메모 하나. 항상 비공개이고, 본인만 접근한다(백엔드가 user_books를 조인해서 소유자 확인).
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261111_reading_notes_rollback.sql
-- RLS를 켜고 정책은 만들지 않는다. 적용 후 백엔드로 작성/조회가 되는지 확인할 것.
--   안 되면: 20261111_reading_notes_disable_rls.sql
-- 주의: user_books의 책을 삭제하면 그 책의 메모도 함께 삭제된다 (ON DELETE CASCADE)

-- [사전 확인] user_books.id 타입이 integer여야 함 (확인 완료: integer)
-- SELECT data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'user_books' AND column_name = 'id';

BEGIN;

CREATE TABLE IF NOT EXISTS public.reading_notes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_book_id integer     NOT NULL UNIQUE
                 REFERENCES public.user_books(id) ON DELETE CASCADE,
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reading_notes_content_check
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
);

-- user_book_id의 UNIQUE 제약이 만드는 인덱스가 책별 조회를 처리하므로 인덱스를 따로 만들지 않는다.

-- RLS 활성화 (정책 없음): Supabase의 anon 키로는 메모를 읽을 수 없다
ALTER TABLE public.reading_notes ENABLE ROW LEVEL SECURITY;

COMMIT;
