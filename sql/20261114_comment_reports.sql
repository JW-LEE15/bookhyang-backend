-- comment_reports: 댓글 신고 (저장만 한다. 자동 숨김·삭제 없음)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일). 순서: SQL 먼저 -> 코드 배포
-- 롤백: 20261114_comment_reports_rollback.sql (코드를 먼저 되돌린 뒤 실행)
-- RLS를 켜고 정책은 만들지 않는다. 적용 후 백엔드로 신고가 되는지 확인할 것.
--   안 되면: 20261114_comment_likes_reports_disable_rls.sql
-- 이 테이블은 기존 서버 코드가 쓰지 않으므로 코드 배포 전에 적용해도 안전하다.
-- 신고자(reporter_id)와 detail은 어떤 API 응답·로그에도 내보내지 않는다.

-- [사전 확인] comments.id는 bigint, users.id는 uuid (20261109_comments.sql 참고)

BEGIN;

CREATE TABLE IF NOT EXISTS public.comment_reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comment_id  bigint      NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  reporter_id uuid        NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  reason      text        NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_reports_reason_check CHECK (reason IN ('spam', 'abuse', 'spoiler', 'other')),
  CONSTRAINT comment_reports_detail_check CHECK (detail IS NULL OR char_length(detail) <= 200),
  CONSTRAINT comment_reports_unique       UNIQUE (comment_id, reporter_id)
);

-- 계정 삭제(CASCADE)용. 댓글별 조회는 UNIQUE 인덱스가 처리한다.
CREATE INDEX IF NOT EXISTS comment_reports_reporter_id_idx ON public.comment_reports (reporter_id);

-- RLS 활성화 (정책 없음)
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

COMMIT;
