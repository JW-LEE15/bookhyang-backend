// test/profileImageValidator.test.js: 프로필 사진 본문 검증 (순수 함수, DB·.env 사용 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMAGE_BYTES,
  MAX_BASE64_LENGTH,
  detectImageType,
  validateProfileImageBody,
} = require('../validators/profileImageValidator');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

// 매직바이트만 맞춘 가짜 이미지 (검증기는 바이트 앞뒤만 본다)
const fakeJpeg = (size = 300) => {
  const buffer = Buffer.alloc(size, 0x11);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buffer, 0);
  Buffer.from([0xff, 0xd9]).copy(buffer, size - 2);
  return buffer;
};
const fakePng = (size = 300) => {
  const buffer = Buffer.alloc(size, 0x22);
  Buffer.from(PNG_SIGNATURE).copy(buffer, 0);
  Buffer.from(PNG_IEND).copy(buffer, size - PNG_IEND.length);
  return buffer;
};
const b64 = (buffer) => buffer.toString('base64');
const validate = (buffer) => validateProfileImageBody({ image: b64(buffer) });

test('JPEG: 통과하고 형식은 image/jpeg, 디코딩한 바이트가 그대로 나온다', () => {
  const source = fakeJpeg();
  const out = validate(source);
  assert.equal(out.ok, true);
  assert.equal(out.value.mime, 'image/jpeg');
  assert.ok(out.value.buffer.equals(source));
});

test('PNG: 통과하고 형식은 image/png', () => {
  const out = validate(fakePng());
  assert.equal(out.ok, true);
  assert.equal(out.value.mime, 'image/png');
});

test('형식은 클라이언트가 보낸 타입이 아니라 바이트로 정한다', () => {
  const out = validateProfileImageBody({ image: b64(fakePng()), mime: 'image/jpeg', type: 'image/gif' });
  assert.equal(out.value.mime, 'image/png');
});

test('JPEG/PNG가 아닌 파일은 400 (GIF, PDF, HTML, WebP, 텍스트)', () => {
  const filler = Buffer.alloc(300, 0x41);
  const samples = {
    GIF: Buffer.concat([Buffer.from('GIF89a'), filler]),
    PDF: Buffer.concat([Buffer.from('%PDF-1.7 '), filler]),
    HTML: Buffer.concat([Buffer.from('<html><script>alert(1)</script>'), filler]),
    WEBP: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), filler]),
    TEXT: filler,
  };
  for (const [name, buffer] of Object.entries(samples)) {
    const out = validate(buffer);
    assert.equal(out.ok, false, name);
    assert.equal(out.status, 400, name);
  }
});

test('시작은 맞지만 끝이 잘린 JPEG/PNG는 400', () => {
  const jpeg = fakeJpeg();
  jpeg[jpeg.length - 1] = 0x00; // FF D9로 끝나지 않음
  assert.equal(validate(jpeg).ok, false);
  const png = fakePng();
  png[png.length - 1] = 0x00; // IEND 청크로 끝나지 않음
  assert.equal(validate(png).ok, false);
});

test('끝은 맞지만 시작이 다른 파일은 400', () => {
  const buffer = fakeJpeg();
  buffer[0] = 0x00;
  assert.equal(validate(buffer).ok, false);
});

test('너무 작은 파일(100바이트 미만)은 400, 100바이트는 통과', () => {
  assert.equal(validate(fakeJpeg(99)).ok, false);
  assert.equal(validate(fakeJpeg(99)).status, 400);
  assert.equal(validate(fakeJpeg(100)).ok, true);
});

test('용량: 100KB(102400바이트)는 통과, 1바이트 넘으면 413', () => {
  assert.equal(MAX_IMAGE_BYTES, 102400);
  assert.equal(validate(fakeJpeg(MAX_IMAGE_BYTES)).ok, true);
  const over = validate(fakeJpeg(MAX_IMAGE_BYTES + 1));
  assert.equal(over.ok, false);
  assert.equal(over.status, 413);
  assert.equal(over.code, 'IMAGE_TOO_LARGE');
});

test('용량: base64 길이가 최대치를 넘으면 디코딩하지 않고 413', () => {
  const out = validateProfileImageBody({ image: 'A'.repeat(MAX_BASE64_LENGTH + 4) });
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.code, 'IMAGE_TOO_LARGE');
});

test('base64가 아니면 400: 접두사, 공백, 이상한 문자, 길이가 4의 배수가 아닌 경우', () => {
  const valid = b64(fakeJpeg());
  const bad = [
    `data:image/jpeg;base64,${valid}`,
    `${valid.slice(0, 8)} ${valid.slice(8)}`,
    `${valid.slice(0, 8)}***${valid.slice(8)}`,
    valid.slice(0, valid.length - 1),
    `=${valid}`,
  ];
  for (const image of bad) {
    const out = validateProfileImageBody({ image });
    assert.equal(out.ok, false, image.slice(0, 20));
    assert.equal(out.status, 400, image.slice(0, 20));
  }
});

test('image가 없거나 문자열이 아니면 400', () => {
  for (const body of [undefined, null, {}, { image: '' }, { image: 123 }, { image: null }, { image: ['AAAA'] }, 'AAAA', []]) {
    const out = validateProfileImageBody(body);
    assert.equal(out.ok, false, JSON.stringify(body));
    assert.equal(out.status, 400, JSON.stringify(body));
  }
});

test('오류 메시지에 입력값을 넣지 않는다', () => {
  const secret = 'SENTINEL_IMAGE_PAYLOAD';
  const out = validateProfileImageBody({ image: `${secret}***` });
  assert.equal(out.ok, false);
  assert.equal(JSON.stringify(out).includes(secret), false);
});

test('detectImageType: Buffer가 아니면 null', () => {
  assert.equal(detectImageType('abc'), null);
  assert.equal(detectImageType(null), null);
  assert.equal(detectImageType(fakeJpeg()), 'image/jpeg');
  assert.equal(detectImageType(fakePng()), 'image/png');
});
