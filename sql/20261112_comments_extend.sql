-- comments 확장: 대댓글(한 단계), 스포일러, 숨김, 삭제 표시
-- 실행: Supabase SQL Editor에서 직접 실행 (기록용 파일)
-- 롤백: 20261112_comments_extend_rollback.sql
-- 기존 댓글은 그대로 유지된다. 새 컬럼 기본값: parent_id NULL, is_spoiler false, is_hidden false, deleted_at NULL
-- 이 SQL은 기존 서버 코드와 호환된다 (기존 INSERT/SELECT는 컬럼을 명시함).
--   그래서 코드를 배포하기 전에 먼저 적용해도 안전하다.
--
-- 설계 메모
--  - parent_id ON DELETE CASCADE: 계정 삭제 시 그 계정 댓글에 달린 답글도 함께 지운다.
--    (SET NULL이면 남의 답글이 원댓글로 둔갑하고, RESTRICT면 계정 삭제가 막힌다)
--  - 답글이 달린 원댓글을 삭제하면 행은 남기고 deleted_at을 채우고 content를 비운다 (앱이 처리).
--    그래서 content 길이 제약은 deleted_at이 있는 행에 한해 완화한다.
--  - 답글은 한 단계만, 부모와 같은 책(isbn)만: 앱이 먼저 검사하고, 트리거가 마지막 방어선이다.
--    (parent_id는 INSERT 때만 정해지고 수정하지 않는다)

-- [사전 확인] 현재 comments 제약 이름 (확인 완료: comments_content_check, comments_isbn13_check, comments_pkey, comments_user_id_fkey)
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.comments'::regclass;

BEGIN;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id  bigint REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_spoiler boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 삭제 표시된 원댓글은 내용이 비므로 내용 길이 제약을 완화
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_content_check;
ALTER TABLE public.comments ADD CONSTRAINT comments_content_check
  CHECK (deleted_at IS NOT NULL OR char_length(btrim(content)) BETWEEN 1 AND 500);

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_not_self_parent;
ALTER TABLE public.comments ADD CONSTRAINT comments_not_self_parent
  CHECK (parent_id IS NULL OR parent_id <> id);

-- 원댓글별 답글 조회, CASCADE 삭제용
CREATE INDEX IF NOT EXISTS comments_parent_id_idx
  ON public.comments (parent_id, id) WHERE parent_id IS NOT NULL;

-- 답글은 한 단계만, 부모와 같은 책(isbn)만 (최후 방어선. 앱에서도 먼저 검사한다)
CREATE OR REPLACE FUNCTION public.comments_check_reply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT isbn, parent_id INTO p FROM public.comments WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RETURN NEW; -- 없는 부모는 FK가 거부한다
  END IF;

  IF p.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'reply_to_reply' USING ERRCODE = '23514';
  END IF;
  IF p.isbn <> NEW.isbn THEN
    RAISE EXCEPTION 'reply_isbn_mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comments_check_reply_trg ON public.comments;
CREATE TRIGGER comments_check_reply_trg
  BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_check_reply();

COMMIT;
