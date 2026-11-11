// services/isbn.js: ISBN을 13자리로 정규화한다.
// user_books.isbn에는 ISBN-10, ISBN-13, "ISBN10 ISBN13" 형태, 하이픈이 든 값, 빈 문자열이 섞여 있을 수 있다.

const ISBN13_PATTERN = /^97[89][0-9]{10}$/;
const ISBN10_PATTERN = /^[0-9]{9}[0-9X]$/;

// ISBN-10 체크섬 확인 (X는 10)
const isValidIsbn10 = (isbn10) => {
  if (!ISBN10_PATTERN.test(isbn10)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const value = isbn10[i] === 'X' ? 10 : Number(isbn10[i]);
    sum += (10 - i) * value;
  }
  return sum % 11 === 0;
};

// ISBN-10 -> ISBN-13 (978 접두 + 새 체크 숫자). 체크섬이 맞지 않으면 null
const isbn10To13 = (isbn10) => {
  if (typeof isbn10 !== 'string') return null;
  const normalized = isbn10.toUpperCase();
  if (!isValidIsbn10(normalized)) return null;
  const base = `978${normalized.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${base}${(10 - (sum % 10)) % 10}`;
};

// 값에서 ISBN13을 얻는다. 13자리가 있으면 그것을, 없으면 ISBN-10을 변환해서, 둘 다 없으면 null
const normalizeIsbn13 = (raw) => {
  if (typeof raw !== 'string') return null;
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(/-/g, '').toUpperCase())
    .filter(Boolean);

  const thirteen = tokens.find((token) => ISBN13_PATTERN.test(token));
  if (thirteen) return thirteen;

  for (const token of tokens) {
    const converted = isbn10To13(token);
    if (converted) return converted;
  }
  return null;
};

module.exports = {
  isValidIsbn10,
  isbn10To13,
  normalizeIsbn13,
};
