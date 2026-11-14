-- users 프로필 사진 컬럼 추가 (사진 원본은 서버가 검증한 JPEG/PNG를 bytea로 저장)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261114_users_profile_image_rollback.sql
-- 순서: 이 SQL을 먼저 실행한 뒤 서버 코드를 배포할 것. (새 코드는 profile_image_updated_at 컬럼을 읽는다)
--   컬럼은 모두 NULL 허용이라서 기존 코드와 기존 행에는 영향이 없다.
-- 컬럼
--   profile_image             사진 바이트 (최대 102400바이트 = 100KB)
--   profile_image_type        'image/jpeg' 또는 'image/png' (서버가 매직바이트로 판정한 값)
--   profile_image_updated_at  올린 시각. 응답의 사진 URL에 ?v=로 붙어 캐시를 갱신한다.
-- 세 컬럼은 모두 NULL(사진 없음)이거나 모두 값이 있어야 한다.
-- 참고: users는 현재 RLS가 꺼져 있다 (20261109_comments_disable_rls.sql 참고). 이 파일은 RLS를 바꾸지 않는다.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_image             bytea,
  ADD COLUMN IF NOT EXISTS profile_image_type        text,
  ADD COLUMN IF NOT EXISTS profile_image_updated_at  timestamptz;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_profile_image_check;
ALTER TABLE public.users ADD CONSTRAINT users_profile_image_check CHECK (
  (profile_image IS NULL AND profile_image_type IS NULL AND profile_image_updated_at IS NULL)
  OR
  (profile_image IS NOT NULL AND profile_image_updated_at IS NOT NULL
   AND profile_image_type IN ('image/jpeg', 'image/png')
   AND octet_length(profile_image) BETWEEN 100 AND 102400)
);

COMMIT;

-- [적용 후 확인] profile_image, profile_image_type, profile_image_updated_at 3개가 보여야 한다
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'users' AND column_name LIKE 'profile_image%'
--  ORDER BY column_name;
