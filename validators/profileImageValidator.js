// validators/profileImageValidator.js: 프로필 사진 업로드 본문 검증 (순수 함수, 외부 의존성 없음)
// 본문: { image: '<base64>' }  (data: 접두사 없는 순수 base64)
// 형식(JPEG/PNG)은 클라이언트가 말한 타입이 아니라 디코딩한 바이트의 매직바이트로 정한다.
// 이 파일은 로그를 출력하지 않고, 오류 메시지에 입력값을 넣지 않는다.

const MAX_IMAGE_BYTES = 100 * 1024; // 102400. users_profile_image_check 제약과 같은 값
const MIN_IMAGE_BYTES = 100; // 제약의 하한과 같은 값. 이보다 작으면 이미지가 아니다
// base64로 인코딩한 최대 길이 (4글자 = 3바이트). 이보다 길면 디코딩하지 않고 거절한다
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const JPEG_START = [0xff, 0xd8, 0xff];
const JPEG_END = [0xff, 0xd9];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]; // IEND 청크 + CRC

const TOO_LARGE_MESSAGE = '사진 용량이 너무 큽니다. (최대 100KB)';
const NOT_IMAGE_MESSAGE = 'JPEG 또는 PNG 사진만 올릴 수 있습니다.';

const fail = (status, message, code) => ({ ok: false, status, message, ...(code ? { code } : {}) });

const startsWith = (buffer, bytes) => bytes.every((byte, i) => buffer[i] === byte);
const endsWith = (buffer, bytes) => {
  const offset = buffer.length - bytes.length;
  return offset >= 0 && bytes.every((byte, i) => buffer[offset + i] === byte);
};

// 바이트로 형식을 판정한다. 'image/jpeg' | 'image/png' | null
const detectImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (startsWith(buffer, JPEG_START) && endsWith(buffer, JPEG_END)) return 'image/jpeg';
  if (startsWith(buffer, PNG_START) && endsWith(buffer, PNG_END)) return 'image/png';
  return null;
};

// 업로드 본문 검증. 통과하면 { ok: true, value: { buffer, mime } }
// 실패하면 { ok: false, status, message, code? } (status는 400 또는 413)
const validateProfileImageBody = (body) => {
  const image = body && typeof body === 'object' ? body.image : undefined;

  if (typeof image !== 'string' || image === '') {
    return fail(400, '사진 데이터(image)를 보내 주세요.');
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return fail(413, TOO_LARGE_MESSAGE, 'IMAGE_TOO_LARGE');
  }
  if (image.length % 4 !== 0 || !BASE64_PATTERN.test(image)) {
    return fail(400, '사진 데이터 형식이 올바르지 않습니다.');
  }

  const buffer = Buffer.from(image, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    return fail(413, TOO_LARGE_MESSAGE, 'IMAGE_TOO_LARGE');
  }
  if (buffer.length < MIN_IMAGE_BYTES) {
    return fail(400, NOT_IMAGE_MESSAGE);
  }

  const mime = detectImageType(buffer);
  if (mime === null) {
    return fail(400, NOT_IMAGE_MESSAGE);
  }

  return { ok: true, value: { buffer, mime } };
};

module.exports = {
  MAX_IMAGE_BYTES,
  MIN_IMAGE_BYTES,
  MAX_BASE64_LENGTH,
  detectImageType,
  validateProfileImageBody,
};
