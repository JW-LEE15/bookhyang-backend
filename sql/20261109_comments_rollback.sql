-- 20261109_comments.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 주의: 저장된 댓글이 모두 삭제된다

BEGIN;

DROP TABLE IF EXISTS public.comments;

COMMIT;
