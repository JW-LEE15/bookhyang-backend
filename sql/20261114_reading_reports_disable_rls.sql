-- reading_reports의 RLS를 끈다 (20261114_reading_reports.sql 적용 후 백엔드로 저장/조회가 안 될 때만 실행)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 다시 켜기: ALTER TABLE public.reading_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_reports DISABLE ROW LEVEL SECURITY;
