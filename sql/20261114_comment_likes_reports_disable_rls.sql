-- comment_likes, comment_reports의 RLS를 끈다
-- (20261114_comment_likes.sql / 20261114_comment_reports.sql 적용 후 백엔드로 하트·신고가 안 될 때만 실행)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 다시 켜기:
--   ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.comment_likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_reports DISABLE ROW LEVEL SECURITY;
