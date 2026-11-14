-- comment_likes: 댓글 하트 (사용자당 댓글 1개에 1번)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일). 순서: SQL 먼저 -> 코드 배포
-- 롤백: 20261114_comment_likes_rollback.sql (코드를 먼저 되돌린 뒤 실행)
-- RLS를 켜고 정책은 만들지 않는다. 적용 후 백엔드로 하트가 되는지 확인할 것.
--   안 되면: 20261114_comment_likes_reports_disable_rls.sql
-- 이 테이블은 기존 서버 코드가 쓰지 않으므로 코드 배포 전에 적용해도 안전하다.
-- 댓글이 실제로 삭제되면 CASCADE로 하트도 지워진다. 삭제 표시(deleted_at) 댓글은 행이 남지만 응답에서 0/false로 가린다.

-- [사전 확인] comments.id는 bigint, users.id는 uuid (20261109_comments.sql 참고)

BEGIN;

CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id bigint      NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- 계정 삭제(CASCADE)용. 댓글별 개수와 "내가 눌렀는지"는 PK가 처리한다.
CREATE INDEX IF NOT EXISTS comment_likes_user_id_idx ON public.comment_likes (user_id);

-- RLS 활성화 (정책 없음)
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

COMMIT;
