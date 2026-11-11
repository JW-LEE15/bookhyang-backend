-- 20261111_reading_notes.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 주의: 저장된 메모가 모두 삭제된다. (user_books와 reading_logs는 건드리지 않는다)

BEGIN;

DROP TABLE IF EXISTS public.reading_notes;

COMMIT;
