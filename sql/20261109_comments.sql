-- comments: 책별 댓글 (책은 ISBN13으로 구분, books 테이블은 참조하지 않음)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261109_comments_rollback.sql
-- RLS를 켜고 정책은 만들지 않는다. 적용 후 백엔드로 작성/조회가 되는지 확인할 것.
--   안 되면: 20261109_comments_disable_rls.sql

-- [사전 확인] users.id 타입이 uuid여야 함 (확인 완료: uuid)
-- SELECT data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

BEGIN;

CREATE TABLE IF NOT EXISTS public.comments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  isbn       char(13)    NOT NULL,
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_isbn13_check  CHECK (isbn ~ '^97[89][0-9]{10}$'),
  CONSTRAINT comments_content_check CHECK (char_length(btrim(content)) BETWEEN 1 AND 500)
);

-- 책별 최신순 목록과 개수: WHERE isbn = ? ORDER BY id DESC
CREATE INDEX IF NOT EXISTS comments_isbn_id_idx ON public.comments (isbn, id DESC);
-- 계정 삭제(CASCADE), 이후 "내가 댓글 단 책" / "작성 댓글 수"용
CREATE INDEX IF NOT EXISTS comments_user_id_idx ON public.comments (user_id);

-- RLS 활성화 (정책 없음)
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

COMMIT;
