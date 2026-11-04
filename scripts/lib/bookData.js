// 수집/import 스크립트 공용 함수: 출력 경로, ISBN13 검사, CSV 쓰기

const fs = require('fs');
const path = require('path');

// 기본 출력 위치: 레포 밖 c:\bookhyang-workspace\bookhyang-data\kakao\
// (scripts/lib → scripts → bookhyang-backend → bookhyang-workspace)
const DEFAULT_OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'bookhyang-data', 'kakao');

const CATEGORIES = ['소설', '시', '에세이'];

// ISBN13 체크섬 확인 (13자리 숫자 문자열 기준)
function isValidIsbn13(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

// 카카오 isbn 필드("ISBN10 ISBN13", 둘 중 하나가 빈 값일 수 있음)에서 ISBN13을 꺼냄
// 반환: { isbn13 } 또는 { isbn13: null, reason }
function extractIsbn13(raw) {
  const tokens = String(raw || '')
    .split(/\s+/)
    .map((t) => t.replace(/-/g, ''))
    .filter(Boolean);
  const candidates = tokens.filter((t) => /^\d{13}$/.test(t));
  const valid = candidates.find(isValidIsbn13);
  if (valid) return { isbn13: valid };
  if (candidates.length > 0) return { isbn13: null, reason: 'ISBN13 체크섬 오류' };
  return { isbn13: null, reason: 'ISBN13 없음' };
}

// 파일 이름용 시각 (로컬 시간): 20261105-143005
function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// UTF-8 BOM + 모든 칸을 따옴표로 감싼 CSV (Excel에서 한글이 깨지지 않게 BOM 포함)
function writeCsv(filePath, columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(','));
  }
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}

// --name value 형태의 간단한 인자 읽기
function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

module.exports = {
  DEFAULT_OUT_DIR,
  CATEGORIES,
  isValidIsbn13,
  extractIsbn13,
  timestamp,
  writeCsv,
  getArg,
};
