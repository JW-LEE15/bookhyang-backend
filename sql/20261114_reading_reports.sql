-- reading_reports: AI 독서 리포트 저장 (사용자별 비공개, 생성할 때마다 1건)
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261114_reading_reports_rollback.sql
-- RLS를 켜고 정책은 만들지 않는다. 적용 후 백엔드로 저장/조회가 되는지 확인할 것.
--   안 되면: 20261114_reading_reports_disable_rls.sql
-- 소유자 확인은 백엔드가 모든 쿼리에 user_id 조건을 넣어서 한다.
-- stats는 서버가 계산한 통계, report는 서버 검증을 통과한 AI 결과다. (메모 원문과 근거 미리보기는 저장하지 않고 id만 저장)

-- [사전 확인] users.id 타입이 uuid여야 함 (확인 완료: uuid, 20261109_comments.sql 참고)
-- SELECT data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';

BEGIN;

CREATE TABLE IF NOT EXISTS public.reading_reports (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_type    text        NOT NULL,
  period_from    date        NOT NULL,  -- [period_from, period_to) 반개구간, 한국 날짜
  period_to      date        NOT NULL,
  include_notes  boolean     NOT NULL DEFAULT false,
  stats          jsonb       NOT NULL,
  report         jsonb       NOT NULL,
  prompt_version integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reading_reports_period_type_check CHECK (period_type IN ('this_month', 'last_month')),
  CONSTRAINT reading_reports_period_check      CHECK (period_from < period_to),
  CONSTRAINT reading_reports_json_check
    CHECK (jsonb_typeof(stats) = 'object' AND jsonb_typeof(report) = 'object')
);

-- 내 리포트 최신순 목록: WHERE user_id = ? ORDER BY id DESC LIMIT 20. 계정 삭제(CASCADE)에도 쓰인다.
CREATE INDEX IF NOT EXISTS reading_reports_user_id_idx ON public.reading_reports (user_id, id DESC);

-- RLS 활성화 (정책 없음): Supabase의 anon 키로는 리포트를 읽을 수 없다
ALTER TABLE public.reading_reports ENABLE ROW LEVEL SECURITY;

COMMIT;
