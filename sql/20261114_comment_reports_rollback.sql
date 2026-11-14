-- 20261114_comment_reports.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 순서 주의: 코드(신고 API)를 먼저 이전 버전으로 되돌린 뒤 실행한다. 반대로 하면 새 코드가 500을 낸다.
-- 주의: 접수된 신고가 모두 삭제된다. 필요하면 먼저 백업할 것. (comments는 건드리지 않는다)

BEGIN;

DROP TABLE IF EXISTS public.comment_reports;

COMMIT;
