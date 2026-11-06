// 분야를 채운 CSV를 books 테이블에 ISBN 기준으로 upsert하는 스크립트
//
// 사용법 (bookhyang-backend 폴더에서):
//   node scripts/import-books-csv.js <csv경로> [--dry-run] [--allow-partial] [--out <폴더>]
//
//   --dry-run        검증하고 DB에서 신규/기존 건수만 조회. DB에 쓰지 않음
//   --allow-partial  실패 행이 있어도 통과한 행만 넣음 (기본: 실패 행이 하나라도 있으면 중단)
//   --out            보고 파일 폴더 (기본: c:\bookhyang-workspace\bookhyang-data\kakao\)
//
// CSV 열: isbn13, title, author (필수) / translator, published_date, cover_image, description, category (선택)
//   - 빈칸은 NULL로 처리. 기존 행의 값은 덮어쓰지 않고 비어 있는 칸만 채움
//   - category는 CSV에 값이 있을 때만 바뀜. 빈칸으로는 기존 분류가 지워지지 않음
//   - 그 밖의 열(kakao_status 등)은 무시
//
// 출력: import_failed_<시각>.csv (실패가 있을 때), import_inserted_<시각>.txt (새로 넣은 id)

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { parse } = require('csv-parse/sync');
const { DEFAULT_OUT_DIR, CATEGORIES, isValidIsbn13, timestamp, writeCsv, getArg } = require('./lib/bookData');

const REQUIRED_COLUMNS = ['isbn13', 'title', 'author'];
const TEXT_COLUMNS = ['title', 'author', 'translator', 'isbn']; // DB 길이 제한을 확인할 열

const argv = process.argv.slice(2);
const csvPath = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const dryRun = argv.includes('--dry-run');
const allowPartial = argv.includes('--allow-partial');
const outDir = path.resolve(getArg(argv, '--out') || DEFAULT_OUT_DIR);

function toNull(v) {
  const s = String(v === null || v === undefined ? '' : v).normalize('NFC').trim();
  return s === '' ? null : s;
}

// 날짜: YYYY-MM-DD (Excel이 바꾼 YYYY/MM/DD, YYYY.MM.DD도 허용) → YYYY-MM-DD
function parseDate(s) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function readCsv(filePath) {
  const buf = fs.readFileSync(filePath);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error('CSV가 UTF-8이 아닙니다. Excel이라면 "CSV UTF-8(쉼표로 분리)"로 다시 저장하세요.');
  }
  if (text.includes('\uFFFD')) {
    throw new Error('CSV에 깨진 글자(�)가 있습니다. "CSV UTF-8"로 다시 저장하세요.');
  }
  return parse(text, {
    bom: true,
    columns: (header) => header.map((h) => String(h).normalize('NFC').trim().toLowerCase()),
    skip_empty_lines: true,
  });
}

// 1단계: 파일만 검증 (DB 접속 없음)
function validate(records) {
  const valid = [];
  const failed = [];
  const firstRowByIsbn = new Map();

  records.forEach((rec, i) => {
    const sheetRow = i + 2; // 1행은 머리글
    const rawIsbn = toNull(rec.isbn13) || '';
    const isbn = rawIsbn.replace(/-/g, '');
    const row = {
      isbn,
      title: toNull(rec.title),
      author: toNull(rec.author),
      translator: toNull(rec.translator),
      published_date: toNull(rec.published_date),
      cover_image: toNull(rec.cover_image),
      description: toNull(rec.description),
      category: toNull(rec.category),
    };
    const reasons = [];

    if (!isbn) reasons.push('isbn13 빈칸');
    else if (/e\+/i.test(isbn)) reasons.push('isbn13이 Excel에서 지수 표기로 바뀜');
    else if (!isValidIsbn13(isbn)) reasons.push('isbn13 형식 또는 체크섬 오류');

    if (!row.title) reasons.push('title 빈칸');
    if (!row.author) reasons.push('author 빈칸');

    if (row.category !== null && !CATEGORIES.includes(row.category)) {
      reasons.push(`category 값 오류("${row.category}"). 빈칸, ${CATEGORIES.join(', ')} 중 하나만 가능`);
    }

    if (row.published_date !== null) {
      const d = parseDate(row.published_date);
      if (!d) reasons.push(`published_date 형식 오류("${row.published_date}")`);
      else row.published_date = d;
    }

    if (row.cover_image !== null && !/^https?:\/\//i.test(row.cover_image)) {
      reasons.push('cover_image가 http(s) 주소가 아님');
    }

    if (isbn && reasons.length === 0) {
      if (firstRowByIsbn.has(isbn)) reasons.push(`CSV 안 중복 ISBN (처음 나온 행: ${firstRowByIsbn.get(isbn)})`);
      else firstRowByIsbn.set(isbn, sheetRow);
    }

    if (reasons.length) failed.push({ row: sheetRow, isbn13: rawIsbn, title: row.title || '', reason: reasons.join(' / ') });
    else valid.push({ sheetRow, ...row });
  });

  return { valid, failed };
}

const UPSERT_SQL = `
  INSERT INTO public.books (isbn, title, author, translator, published_date, cover_image, description, category)
  VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)
  ON CONFLICT (isbn) DO UPDATE SET
    title          = COALESCE(books.title,          EXCLUDED.title),
    author         = COALESCE(books.author,         EXCLUDED.author),
    translator     = COALESCE(books.translator,     EXCLUDED.translator),
    published_date = COALESCE(books.published_date, EXCLUDED.published_date),
    cover_image    = COALESCE(books.cover_image,    EXCLUDED.cover_image),
    description    = COALESCE(books.description,    EXCLUDED.description),
    category       = COALESCE(EXCLUDED.category,    books.category)
  RETURNING id, (xmax = 0) AS inserted
`;

async function main() {
  if (!csvPath) {
    console.error('사용법: node scripts/import-books-csv.js <csv경로> [--dry-run] [--allow-partial] [--out <폴더>]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const ts = timestamp();

  const records = readCsv(csvPath);
  const header = records.length ? Object.keys(records[0]) : [];
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (records.length && missing.length) {
    throw new Error(`필수 열이 없습니다: ${missing.join(', ')}`);
  }
  console.log(`[검증] ${path.basename(csvPath)}: ${records.length}행`);

  const { valid, failed } = validate(records);

  // 2단계: DB 읽기 (컬럼 확인, 길이 제한, 기존 행 조회)
  const pool = require('../db');
  const client = await pool.connect();
  try {
    const colRes = await client.query(
      `SELECT column_name, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'books'`
    );
    const cols = new Map(colRes.rows.map((r) => [r.column_name, r.character_maximum_length]));
    for (const c of ['category', 'description']) {
      if (!cols.has(c)) {
        throw new Error(`books에 ${c} 컬럼이 없습니다. sql/20261105_books_category_description.sql을 먼저 실행하세요.`);
      }
    }

    // DB 길이 제한 초과 행을 실패로 옮김
    const fitting = [];
    for (const row of valid) {
      const over = TEXT_COLUMNS.filter((c) => {
        const max = cols.get(c);
        return max && row[c] && row[c].length > max;
      });
      if (over.length) {
        failed.push({ row: row.sheetRow, isbn13: row.isbn, title: row.title, reason: `길이 초과: ${over.map((c) => `${c}(최대 ${cols.get(c)})`).join(', ')}` });
      } else {
        fitting.push(row);
      }
    }
    failed.sort((a, b) => a.row - b.row);

    const existingRes = await client.query('SELECT isbn, category FROM public.books WHERE isbn = ANY($1)', [fitting.map((r) => r.isbn)]);
    const existing = new Map(existingRes.rows.map((r) => [r.isbn, r.category]));
    const newCount = fitting.filter((r) => !existing.has(r.isbn)).length;
    const categoryChanges = fitting.filter((r) => existing.has(r.isbn) && r.category !== null && existing.get(r.isbn) !== r.category).length;
    const withCategory = fitting.filter((r) => r.category !== null).length;

    console.log(`  통과 ${fitting.length}행 (분야 지정 ${withCategory}) / 실패 ${failed.length}행`);
    console.log(`  예상: 신규 ${newCount}, 기존 ${fitting.length - newCount} (그중 분류가 바뀌는 행 ${categoryChanges})`);

    if (failed.length) {
      const failedPath = path.join(outDir, `import_failed_${ts}.csv`);
      writeCsv(failedPath, ['row', 'isbn13', 'title', 'reason'], failed);
      console.log(`  실패 행 목록: ${failedPath}`);
      failed.slice(0, 10).forEach((f) => console.log(`    ${f.row}행 ${f.isbn13 || '(isbn 없음)'}: ${f.reason}`));
      if (failed.length > 10) console.log(`    ... 외 ${failed.length - 10}행`);
    }

    if (dryRun) {
      console.log('\n--dry-run: DB에 쓰지 않고 종료합니다.');
      return;
    }
    if (failed.length && !allowPartial) {
      console.log('\n실패 행이 있어 중단합니다. 고친 뒤 다시 실행하거나, 통과한 행만 넣으려면 --allow-partial을 붙이세요.');
      process.exitCode = 1;
      return;
    }
    if (fitting.length === 0) {
      console.log('\n넣을 행이 없습니다.');
      return;
    }

    // 3단계: 트랜잭션 하나로 upsert. 오류가 나면 전체 롤백
    console.log('\n[반영] 시작');
    const insertedIds = [];
    let updated = 0;
    await client.query('BEGIN');
    try {
      for (let i = 0; i < fitting.length; i++) {
        const r = fitting[i];
        let res;
        try {
          res = await client.query(UPSERT_SQL, [r.isbn, r.title, r.author, r.translator, r.published_date, r.cover_image, r.description, r.category]);
        } catch (err) {
          err.message = `${r.sheetRow}행 (${r.isbn}) 처리 중 오류: ${err.message}`;
          throw err;
        }
        if (res.rows[0].inserted) insertedIds.push(res.rows[0].id);
        else updated++;
        if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${fitting.length}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`\n오류로 전체 롤백했습니다. DB는 바뀌지 않았습니다.\n${err.message}`);
      process.exitCode = 1;
      return;
    }

    const insertedPath = path.join(outDir, `import_inserted_${ts}.txt`);
    const idList = insertedIds.join(',');
    fs.writeFileSync(
      insertedPath,
      [
        `# ${path.basename(csvPath)} import로 새로 넣은 books.id (${insertedIds.length}건)`,
        '# 되돌리기: user_books가 참조하는 책은 남기고, 참조되지 않는 책만 지움',
        '#   (user_books_book_id_fkey가 ON DELETE CASCADE라 책을 지우면 서재 기록도 같이 지워지기 때문)',
        '#   기존 행(갱신된 행)에 채운 값은 이 방법으로 되돌려지지 않음 → 백업 테이블로 복구',
        ...(insertedIds.length
          ? [
              '# 1) 참조되고 있어 남게 될 책 확인:',
              `# SELECT b.id, b.title FROM public.books b WHERE b.id IN (${idList}) AND EXISTS (SELECT 1 FROM public.user_books ub WHERE ub.book_id = b.id);`,
              '# 2) 참조되지 않는 책만 지우기:',
              `# DELETE FROM public.books b WHERE b.id IN (${idList}) AND NOT EXISTS (SELECT 1 FROM public.user_books ub WHERE ub.book_id = b.id);`,
            ]
          : ['# 새로 넣은 행 없음']),
        idList,
        '',
      ].join('\r\n'),
      'utf8'
    );

    console.log(`\n[결과] 신규 ${insertedIds.length} / 기존 행 갱신 ${updated} (분류 변경 ${categoryChanges}) / 실패 ${failed.length}`);
    console.log(`새로 넣은 id 목록: ${insertedPath}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('import 중단:', err.message);
  process.exit(1);
});
