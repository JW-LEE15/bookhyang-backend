// test/readingValidator.test.js: 완독일 검증과 한국 날짜 계산 (순수 함수 테스트)
const test = require('node:test');
const assert = require('node:assert/strict');
const { todayKst } = require('../services/kstDate');
const {
  STATUSES,
  NOTE_MAX_LENGTH,
  parseUserBookId,
  normalizeStatus,
  validateReadEndDate,
  validateNoteContent,
} = require('../validators/readingValidator');

test('메모: 정상 값은 trim해서 돌려주고 내부 줄바꿈은 유지', () => {
  assert.deepEqual(validateNoteContent({ content: '  좋은 책\n둘째 줄  ' }), {
    ok: true,
    value: { content: '좋은 책\n둘째 줄' },
  });
  assert.equal(validateNoteContent({ content: '가' }).ok, true);
});

test('메모: 1~2000자 (코드포인트 기준)', () => {
  assert.equal(NOTE_MAX_LENGTH, 2000);
  assert.equal(validateNoteContent({ content: '가'.repeat(2000) }).ok, true);
  assert.equal(validateNoteContent({ content: '가'.repeat(2001) }).ok, false);
  assert.equal(validateNoteContent({ content: '😀'.repeat(2000) }).ok, true); // 이모지는 1글자
  assert.equal(validateNoteContent({ content: '😀'.repeat(2001) }).ok, false);
  assert.equal(validateNoteContent({ content: `  ${'가'.repeat(2000)}  ` }).ok, true); // trim 후 길이
});

test('메모: 비었거나 공백뿐이거나 문자열이 아니면 거부', () => {
  const bads = ['', ' ', '   ', '\n\t ', null, undefined, 123, true, ['메모'], { a: 1 }];
  for (const bad of bads) {
    assert.equal(validateNoteContent({ content: bad }).ok, false, `입력: ${JSON.stringify(bad)}`);
  }
  assert.equal(validateNoteContent({}).ok, false);
  assert.equal(validateNoteContent(undefined).ok, false);
  assert.equal(validateNoteContent(null).ok, false);
});

test('메모: NUL 문자는 거부 (Postgres text에 저장 불가)', () => {
  assert.equal(validateNoteContent({ content: 'a\u0000b' }).ok, false);
  assert.equal(validateNoteContent({ content: '\u0000' }).ok, false);
});

test('status 허용 목록', () => {
  assert.deepEqual(STATUSES, ['READING', 'COMPLETED', 'WISH']);
});

test('normalizeStatus: 세 값은 그대로, 대소문자만 다른 값은 대문자로', () => {
  for (const status of STATUSES) {
    assert.deepEqual(normalizeStatus(status), { ok: true, value: status });
    assert.deepEqual(normalizeStatus(status.toLowerCase()), { ok: true, value: status });
  }
  assert.equal(normalizeStatus('Completed').value, 'COMPLETED');
  assert.equal(normalizeStatus('reading').value, 'READING');
  assert.equal(normalizeStatus('wIsH').value, 'WISH');
});

test('normalizeStatus: 그 밖의 값은 거부', () => {
  const bads = ['', ' ', 'FINISHED', '완독', 'COMPLETE', ' COMPLETED', 'COMPLETED ', 'READING\n',
    null, undefined, 1, true, {}, ['READING']];
  for (const bad of bads) {
    const result = normalizeStatus(bad);
    assert.equal(result.ok, false, `입력: ${JSON.stringify(bad)}`);
    assert.equal(typeof result.message, 'string');
  }
});

// 한국 시간 2026-11-11 12:00 = UTC 03:00
const NOW = new Date('2026-11-11T03:00:00Z');

test('todayKst: UTC 15:00 이후는 한국 날짜가 하루 넘어간다', () => {
  assert.equal(todayKst(new Date('2026-11-10T14:59:59Z')), '2026-11-10');
  assert.equal(todayKst(new Date('2026-11-10T15:00:00Z')), '2026-11-11');
  assert.equal(todayKst(new Date('2026-12-31T15:30:00Z')), '2027-01-01');
});

test('parseUserBookId: 양의 정수(integer 범위)만 허용', () => {
  assert.equal(parseUserBookId('12'), 12);
  assert.equal(parseUserBookId('2147483647'), 2147483647);
  for (const bad of ['0', '-1', '01', 'abc', '1.5', '2147483648', '', ' 1', undefined, 5]) {
    assert.equal(parseUserBookId(bad), null, `입력: ${String(bad)}`);
  }
});

test('완독일: 정상 값', () => {
  assert.deepEqual(validateReadEndDate({ read_end_date: '2026-11-01' }, NOW), {
    ok: true,
    value: { readEndDate: '2026-11-01' },
  });
  assert.equal(validateReadEndDate({ read_end_date: '2024-02-29' }, NOW).ok, true); // 윤년
  assert.equal(validateReadEndDate({ read_end_date: '1900-01-01' }, NOW).ok, true);
});

test('완독일: 오늘(한국)은 허용, 내일은 거부', () => {
  assert.equal(validateReadEndDate({ read_end_date: '2026-11-11' }, NOW).ok, true);
  assert.equal(validateReadEndDate({ read_end_date: '2026-11-12' }, NOW).ok, false);
});

test('완독일: UTC로는 아직 전날이어도 한국 날짜 기준으로 판단', () => {
  const lateNight = new Date('2026-11-10T16:00:00Z'); // 한국 11-11 01:00
  assert.equal(validateReadEndDate({ read_end_date: '2026-11-11' }, lateNight).ok, true);
  assert.equal(validateReadEndDate({ read_end_date: '2026-11-12' }, lateNight).ok, false);
});

test('완독일: 없는 날짜와 형식 오류는 거부', () => {
  const bads = [
    '2026-02-30', '2023-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '1899-12-31',
    '2026-1-1', '2026/11/01', '20261101', '2026-11-01T00:00:00Z', ' 2026-11-01', '2026-11-01\n',
    '', null, undefined, 20261101, ['2026-11-01'],
  ];
  for (const bad of bads) {
    assert.equal(validateReadEndDate({ read_end_date: bad }, NOW).ok, false, `입력: ${JSON.stringify(bad)}`);
  }
  assert.equal(validateReadEndDate({}, NOW).ok, false);
  assert.equal(validateReadEndDate(undefined, NOW).ok, false);
});
