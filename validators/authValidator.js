// validators/authValidator.js: 회원가입·로그인 입력값 검증 (외부 의존성 없음)

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt는 72바이트 이후를 무시한다
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 20;

// 아주 기본적인 형식만 확인한다 (공백 없음, @ 하나, 도메인에 점 포함)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 글자 수 (한글·이모지도 1글자로 센다)
const charLength = (str) => [...str].length;

// 이메일 정규화: 앞뒤 공백 제거 + 소문자. 문자열이 아니면 빈 문자열.
const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const fail = (message) => ({ ok: false, message });

const NICKNAME_LENGTH_MESSAGE = `닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자로 입력해 주세요.`;
const isNicknameLengthValid = (nickname) => {
  const length = charLength(nickname);
  return length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH;
};

// 닉네임 수정에서 거부할 문자: 제어문자(줄바꿈·탭 포함), 폭 없는 공백, 방향 제어, 줄·문단 구분자, BOM
// (이모지를 잇는 ZWJ U+200D는 거부하지 않는다)
const INVISIBLE_PATTERN = /[\p{Cc}\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;

// 회원가입 검증. 통과하면 { ok: true, value: { email, password, nickname } }
const validateSignup = (body) => {
  const { email, password, nickname } = body || {};

  if (
    typeof email !== 'string' || email.trim() === '' ||
    typeof password !== 'string' || password === '' ||
    typeof nickname !== 'string' || nickname.trim() === ''
  ) {
    return fail('이메일, 비밀번호, 닉네임을 모두 입력해 주세요.');
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length > EMAIL_MAX_LENGTH) {
    return fail(`이메일은 ${EMAIL_MAX_LENGTH}자 이하로 입력해 주세요.`);
  }
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return fail('올바른 이메일 형식이 아닙니다.');
  }

  // 비밀번호는 공백도 그대로 둔다 (trim 하지 않음)
  if (charLength(password) < PASSWORD_MIN_LENGTH) {
    return fail(`비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return fail(`비밀번호가 너무 깁니다. (최대 ${PASSWORD_MAX_BYTES}바이트)`);
  }

  const trimmedNickname = nickname.trim();
  if (!isNicknameLengthValid(trimmedNickname)) {
    return fail(NICKNAME_LENGTH_MESSAGE);
  }

  return {
    ok: true,
    value: { email: normalizedEmail, password, nickname: trimmedNickname },
  };
};

// 닉네임 수정 검증. 통과하면 { ok: true, value: { nickname } }
// 가입과 같은 길이 규칙에 더해, 제어문자와 눈에 안 보이는 문자를 거부한다. (가입 동작은 바꾸지 않는다)
// 유니코드 NFC로 정규화해서 저장한다. (자모가 분리된 한글 입력 대비)
const validateNicknameUpdate = (body) => {
  const { nickname } = body || {};

  if (typeof nickname !== 'string' || nickname.trim() === '') {
    return fail('닉네임을 입력해 주세요.');
  }

  const normalized = nickname.trim().normalize('NFC');
  if (INVISIBLE_PATTERN.test(normalized)) {
    return fail('닉네임에 사용할 수 없는 문자가 있습니다.');
  }
  if (!isNicknameLengthValid(normalized)) {
    return fail(NICKNAME_LENGTH_MESSAGE);
  }

  return { ok: true, value: { nickname: normalized } };
};

// 로그인 검증. 길이 규칙은 적용하지 않고, 값이 있는 문자열인지만 확인한다.
const validateLogin = (body) => {
  const { email, password } = body || {};

  if (
    typeof email !== 'string' || email.trim() === '' ||
    typeof password !== 'string' || password === ''
  ) {
    return fail('이메일과 비밀번호를 입력해 주세요.');
  }

  return { ok: true, value: { email: normalizeEmail(email), password } };
};

module.exports = {
  normalizeEmail,
  validateSignup,
  validateNicknameUpdate,
  validateLogin,
};
