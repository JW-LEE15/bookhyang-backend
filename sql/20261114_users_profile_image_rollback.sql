-- 20261114_users_profile_image.sql 롤백
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 순서: 서버 코드를 이 변경 전 버전으로 먼저 되돌린 뒤 실행할 것
--   (새 코드가 남아 있으면 로그인과 댓글 조회가 컬럼이 없다는 오류로 실패한다)
-- 주의: 올라간 프로필 사진은 모두 삭제된다. 되돌릴 수 없다.

BEGIN;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_profile_image_check;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS profile_image,
  DROP COLUMN IF EXISTS profile_image_type,
  DROP COLUMN IF EXISTS profile_image_updated_at;

COMMIT;
