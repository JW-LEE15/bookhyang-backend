-- 20261114_reading_reports.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 주의: 저장된 AI 독서 리포트가 모두 삭제된다. (user_books, reading_notes는 건드리지 않는다)

BEGIN;

DROP TABLE IF EXISTS public.reading_reports;

COMMIT;
