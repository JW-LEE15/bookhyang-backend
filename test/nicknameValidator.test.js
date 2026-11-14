// test/nicknameValidator.test.js: 닉네임 수정 검증, 가입 검증이 그대로인지 확인 (순수 함수, DB·.env 사용 없음)
// 눈에 안 보이는 문자는 소스에 직접 쓰지 않고 코드 포인트로 만든다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNicknameUpdate, validateSignup } = require('../validators/authValidator');

const nick = (nickname) => validateNicknameUpdate({ nickname });
const between = (code) => `가${String.fromCodePoint(code)}나`; // 가 + 문자 + 나

test('수정: 정상 닉네임은 trim 되어 통과한다', () => {
  assert.deepEqual(nick('  책벌레  '), { ok: true, value: { nickname: '책벌레' } });
});

test('수정: 2자와 20자는 통과, 1자와 21자는 거부', () => {
  assert.equal(nick('가나').ok, true);
  assert.equal(nick('가'.repeat(20)).ok, true);
  assert.equal(nick('가').ok, false);
  assert.equal(nick('가'.repeat(21)).ok, false);
});

test('수정: 이모지는 1글자로 센다', () => {
  assert.equal(nick('📚📚').ok, true); // 2글자
  assert.equal(nick('📚').ok, false); // 1글자
  assert.equal(nick('📚'.repeat(20)).ok, true);
  assert.equal(nick('📚'.repeat(21)).ok, false);
});

test('수정: 비어 있거나 공백뿐이거나 문자열이 아니면 거부', () => {
  for (const value of ['', '   ', null, undefined, 123, {}, ['가나']]) {
    assert.equal(nick(value).ok, false, String(value));
  }
  assert.equal(validateNicknameUpdate(undefined).ok, false);
  assert.equal(validateNicknameUpdate(null).ok, false);
});

test('수정: 제어문자와 눈에 안 보이는 문자는 거부', () => {
  const codes = {
    NUL: 0x0000, TAB: 0x0009, LF: 0x000a, CR: 0x000d, DEL: 0x007f,
    ZWSP: 0x200b, ZWNJ: 0x200c, LRM: 0x200e, RLM: 0x200f,
    LINE_SEP: 0x2028, PARA_SEP: 0x2029, RLO: 0x202e, WORD_JOINER: 0x2060, BOM: 0xfeff,
  };
  for (const [name, code] of Object.entries(codes)) {
    const out = nick(between(code));
    assert.equal(out.ok, false, name);
    assert.match(out.message, /사용할 수 없는 문자/, name);
  }
});

test('수정: 이모지를 잇는 ZWJ(U+200D)는 허용한다', () => {
  const zwj = String.fromCodePoint(0x200d);
  assert.equal(nick(`👨${zwj}👩${zwj}👧`).ok, true);
});

test('수정: 앞뒤의 BOM·줄바꿈은 trim 되고 중간의 것만 거부된다', () => {
  assert.deepEqual(nick(`${String.fromCodePoint(0xfeff)}책벌레\n`), { ok: true, value: { nickname: '책벌레' } });
});

test('수정: NFC로 정규화해서 저장한다 (자모 분리 한글 입력)', () => {
  const decomposed = '한글'.normalize('NFD');
  assert.notEqual(decomposed, '한글');
  assert.deepEqual(nick(decomposed), { ok: true, value: { nickname: '한글' } });
});

test('가입: 동작이 그대로다 (같은 길이 규칙, 눈에 안 보이는 문자는 따로 거르지 않는다)', () => {
  const signup = (nickname) => validateSignup({ email: 'a@b.co', password: '12345678', nickname });
  assert.deepEqual(signup('  책벌레 ').value, { email: 'a@b.co', password: '12345678', nickname: '책벌레' });
  assert.equal(signup('가').ok, false);
  assert.equal(signup('가'.repeat(21)).ok, false);
  assert.equal(signup('가'.repeat(20)).ok, true);
  assert.match(signup('가').message, /2~20자/);
  assert.equal(signup(between(0x200b)).ok, true); // 제어문자 규칙은 PATCH에만 적용
});
