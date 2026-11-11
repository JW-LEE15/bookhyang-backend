-- 20261112_comments_extend.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 순서: 서버 코드를 확장 전 버전으로 먼저 되돌린 뒤 실행할 것 (새 컬럼을 쓰는 코드가 남아 있으면 오류)
-- 주의: 확장 후에 생긴 답글과 삭제 표시된 댓글은 삭제된다. 확장 전에 있던 댓글은 그대로다.
--   - 답글을 남기면 parent_id 컬럼 제거 후 원댓글처럼 보이게 된다
--   - 삭제 표시 댓글은 content가 비어 있어서 옛 content 제약에 맞지 않는다
-- 주의: 숨김 표시(is_hidden)와 스포일러 표시(is_spoiler)는 사라진다. 숨겼던 댓글이 다시 보이게 된다.

BEGIN;

DELETE FROM public.comments WHERE parent_id IS NOT NULL;
DELETE FROM public.comments WHERE deleted_at IS NOT NULL;

DROP TRIGGER  IF EXISTS comments_check_reply_trg ON public.comments;
DROP FUNCTION IF EXISTS public.comments_check_reply();
DROP INDEX    IF EXISTS public.comments_parent_id_idx;
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_not_self_parent;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_content_check;
ALTER TABLE public.comments ADD CONSTRAINT comments_content_check
  CHECK (char_length(btrim(content)) BETWEEN 1 AND 500);

ALTER TABLE public.comments
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_hidden,
  DROP COLUMN IF EXISTS is_spoiler,
  DROP COLUMN IF EXISTS parent_id;

COMMIT;
