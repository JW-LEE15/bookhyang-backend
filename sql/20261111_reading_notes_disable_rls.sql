-- reading_notes의 RLS를 끈다 (20261111_reading_notes.sql 적용 후 백엔드로 작성/조회가 안 될 때만 실행)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 참고: books, user_books, users는 현재 RLS가 꺼져 있다 (relrowsecurity = false)
-- 다시 켜기: ALTER TABLE public.reading_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_notes DISABLE ROW LEVEL SECURITY;
