// 카카오 도서 검색에서 민음사 책을 모아 CSV로 저장하는 스크립트 (DB에는 접속하지 않음)
//
// 사용법 (bookhyang-backend 폴더에서):
//   node scripts/collect-minumsa-books.js [--out <폴더>] [--no-cover] [--no-description] [--delay <ms>]
//
//   --out             출력 폴더 (기본: c:\bookhyang-workspace\bookhyang-data\kakao\)
//   --no-cover        표지 URL을 저장하지 않음 (cover_image 칸을 비움)
//   --no-description  소개글을 저장하지 않음 (description 칸을 비움)
//   --delay           요청 사이 대기 시간 ms (기본 300)
//
// 출력: books_collected_<시각>.csv, excluded_<시각>.csv, report_<시각>.txt

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const axios = require('axios');
const { DEFAULT_OUT_DIR, extractIsbn13, timestamp, writeCsv, getArg } = require('./lib/bookData');

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY;
const API_URL = 'https://dapi.kakao.com/v3/search/book';
const PUBLISHER = '민음사';
const PAGE_SIZE = 50; // 카카오 최대값
const MAX_PAGE = 50; // 카카오 page 최대값. 실제로 받을 수 있는 양은 meta.pageable_count까지 (2026-11-05 실행: 1000)
const SORTS = ['accuracy', 'latest'];
const RETRY_DELAYS = [1000, 2000, 4000];

const argv = process.argv.slice(2);
const outDir = path.resolve(getArg(argv, '--out') || DEFAULT_OUT_DIR);
const noCover = argv.includes('--no-cover');
const noDescription = argv.includes('--no-description');
const delayMs = Number(getArg(argv, '--delay') || 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 한 페이지 요청. 429/5xx/네트워크 오류는 재시도, 400/401/403은 즉시 중단
async function fetchPage(sort, page) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios.get(API_URL, {
        params: { query: PUBLISHER, target: 'publisher', sort, page, size: PAGE_SIZE },
        headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
        timeout: 10000,
      });
      return res.data;
    } catch (err) {
      const status = err.response ? err.response.status : null;
      if (status === 400 || status === 401 || status === 403) {
        const e = new Error(`카카오 응답 ${status} (sort=${sort}, page=${page}). 키나 요청 값을 확인하세요.`);
        e.fatal = true;
        throw e;
      }
      if (attempt >= RETRY_DELAYS.length) {
        throw new Error(`재시도 실패 (sort=${sort}, page=${page}, status=${status || err.code || err.message})`);
      }
      console.log(`  재시도 ${attempt + 1}/${RETRY_DELAYS.length} (sort=${sort}, page=${page}, status=${status || err.code})`);
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
}

function clean(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFC').trim();
}

function joinNames(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(clean)
    .filter(Boolean)
    .join(', ');
}

async function main() {
  if (!KAKAO_API_KEY) {
    console.error('카카오 키가 없습니다. bookhyang-backend/.env에 KAKAO_REST_API_KEY 또는 KAKAO_API_KEY가 있어야 합니다.');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const ts = timestamp();
  const startedAt = Date.now();

  // 1) 수집
  const rawDocs = [];
  const metaBySort = {};
  const failedPages = [];
  let requestCount = 0;

  for (const sort of SORTS) {
    console.log(`[수집] sort=${sort}`);
    let received = 0;
    for (let page = 1; page <= MAX_PAGE; page++) {
      let data;
      try {
        data = await fetchPage(sort, page);
        requestCount++;
      } catch (err) {
        if (err.fatal) throw err;
        console.log(`  ${err.message} → 이 페이지는 건너뜀`);
        failedPages.push(`${sort}:${page}`);
        await sleep(delayMs);
        continue;
      }
      const docs = (data && data.documents) || [];
      const meta = (data && data.meta) || {};
      if (page === 1) metaBySort[sort] = { total_count: meta.total_count, pageable_count: meta.pageable_count };
      docs.forEach((d) => rawDocs.push(d));
      received += docs.length;
      if (page % 10 === 0) console.log(`  page ${page}, 누적 ${received}건`);
      if (meta.is_end || docs.length === 0) break;
      await sleep(delayMs);
    }
    metaBySort[sort] = { ...(metaBySort[sort] || {}), received };
    console.log(`  sort=${sort} 완료: ${received}건`);
  }

  // 2) 같은 책 병합 (두 정렬에서 같은 책이 겹쳐 나오므로 먼저 합친 뒤 건수를 셈)
  //    키: 유효한 ISBN13 → 없으면 카카오 상세 url → 없으면 제목|출판사|날짜
  const uniqueMap = new Map();
  for (const d of rawDocs) {
    const { isbn13 } = extractIsbn13(d.isbn);
    const key = isbn13 || (d.url ? `url:${d.url}` : `raw:${clean(d.title)}|${clean(d.publisher)}|${clean(d.datetime)}`);
    if (!uniqueMap.has(key)) uniqueMap.set(key, d);
  }
  const uniqueDocs = [...uniqueMap.values()];

  // 3) 필터와 변환
  const kept = [];
  const excluded = [];
  const excludedPublishers = new Map();
  const reasonCounts = { 'ISBN13 없음': 0, 'ISBN13 체크섬 오류': 0, '제목 없음': 0, '저자 없음': 0 };

  for (const d of uniqueDocs) {
    const publisher = clean(d.publisher);
    const base = {
      kakao_publisher: publisher,
      title: clean(d.title),
      authors: joinNames(d.authors),
      isbn_raw: clean(d.isbn),
      datetime: clean(d.datetime),
    };

    if (publisher !== PUBLISHER) {
      const name = publisher || '(빈 값)';
      excludedPublishers.set(name, (excludedPublishers.get(name) || 0) + 1);
      excluded.push({ reason: '출판사 불일치', ...base });
      continue;
    }

    const { isbn13, reason } = extractIsbn13(d.isbn);
    if (!isbn13) {
      reasonCounts[reason]++;
      excluded.push({ reason, ...base });
      continue;
    }
    if (!base.title) {
      reasonCounts['제목 없음']++;
      excluded.push({ reason: '제목 없음', ...base });
      continue;
    }
    if (!base.authors) {
      reasonCounts['저자 없음']++;
      excluded.push({ reason: '저자 없음', ...base });
      continue;
    }

    // datetime 예: 2000-12-20T00:00:00.000+09:00 → 앞 10자리 (Date로 바꾸면 UTC 변환으로 하루 밀릴 수 있음)
    const dt = clean(d.datetime);
    const publishedDate = /^\d{4}-\d{2}-\d{2}/.test(dt) ? dt.slice(0, 10) : '';

    kept.push({
      isbn13,
      title: base.title,
      author: base.authors,
      translator: joinNames(d.translators),
      published_date: publishedDate,
      cover_image: noCover ? '' : clean(d.thumbnail),
      description: noDescription ? '' : clean(d.contents),
      category: '',
      kakao_status: clean(d.status),
    });
  }

  kept.sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.isbn13.localeCompare(b.isbn13));

  // 4) 파일 저장
  const collectedPath = path.join(outDir, `books_collected_${ts}.csv`);
  const excludedPath = path.join(outDir, `excluded_${ts}.csv`);
  const reportPath = path.join(outDir, `report_${ts}.txt`);

  writeCsv(
    collectedPath,
    ['isbn13', 'title', 'author', 'translator', 'published_date', 'cover_image', 'description', 'category', 'kakao_status'],
    kept
  );
  writeCsv(excludedPath, ['reason', 'kakao_publisher', 'title', 'authors', 'isbn_raw', 'datetime'], excluded);

  const publisherLines = [...excludedPublishers.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `  - ${name}: ${n}`);
  const metaLines = SORTS.map((s) => {
    const m = metaBySort[s] || {};
    return `  - sort=${s}: total_count=${m.total_count ?? '?'}, pageable_count=${m.pageable_count ?? '?'}, 받은 건수=${m.received ?? 0}`;
  });
  // 상한 판단: 받은 건수가 pageable_count와 같거나 한 페이지(50건) 안쪽으로 가깝고,
  // total_count가 받은 건수보다 크면 pageable 상한에 걸린 것으로 봄
  const capLines = SORTS.map((s) => {
    const m = metaBySort[s] || {};
    const total = Number(m.total_count);
    const pageable = Number(m.pageable_count);
    const received = m.received || 0;
    if (!Number.isFinite(total) || !Number.isFinite(pageable)) {
      return `  - sort=${s}: meta를 받지 못해 상한 여부를 알 수 없습니다.`;
    }
    if (total <= received) {
      return `  - sort=${s}: total_count ${total}건을 모두 받았습니다.`;
    }
    const missed = total - received;
    if (received >= pageable - PAGE_SIZE) {
      return `  - sort=${s}: ※ pageable 상한(${pageable}건)에 걸렸고, total_count ${total}건 중 ${missed}건은 받지 못했습니다.`;
    }
    return `  - sort=${s}: ※ pageable_count(${pageable}건)보다 적게 받았고(${received}건), total_count ${total}건 중 ${missed}건은 받지 못했습니다. 실패한 페이지를 확인하세요.`;
  });
  // 두 정렬을 합친 뒤의 추정치 (total_count는 카카오 검색 문서 수, 비교 대상은 병합 후 고유 문서 수)
  const maxTotal = Math.max(0, ...SORTS.map((s) => Number((metaBySort[s] || {}).total_count) || 0));
  const combinedMissed = Math.max(0, maxTotal - uniqueDocs.length);

  const report = [
    `민음사 수집 보고서 (${ts})`,
    '',
    `요청 횟수: ${requestCount}, 걸린 시간: ${Math.round((Date.now() - startedAt) / 1000)}초`,
    `옵션: 표지 ${noCover ? '저장 안 함' : '저장'}, 소개글 ${noDescription ? '저장 안 함' : '저장'}, 요청 간격 ${delayMs}ms`,
    '',
    '[카카오 meta]',
    ...metaLines,
    '',
    '[상한 판단]',
    ...capLines,
    `  두 정렬 합친 뒤(병합 후 ${uniqueDocs.length}건) 기준으로 total_count ${maxTotal}건 중 약 ${combinedMissed}건은 받지 못한 것으로 추정됩니다.`,
    failedPages.length ? `  ※ 실패해서 건너뛴 페이지: ${failedPages.join(', ')}` : '  실패한 페이지 없음',
    '',
    '[건수]',
    `  받은 문서 합계: ${rawDocs.length}`,
    `  같은 책 병합 후: ${uniqueDocs.length} (병합된 중복 ${rawDocs.length - uniqueDocs.length})`,
    `  출판사 불일치 제외: ${[...excludedPublishers.values()].reduce((a, b) => a + b, 0)}`,
    `  ISBN13 없음 제외: ${reasonCounts['ISBN13 없음']}`,
    `  ISBN13 체크섬 오류 제외: ${reasonCounts['ISBN13 체크섬 오류']}`,
    `  제목 없음 제외: ${reasonCounts['제목 없음']}`,
    `  저자 없음 제외: ${reasonCounts['저자 없음']}`,
    `  최종 수집: ${kept.length}`,
    '',
    `[제외한 출판사 이름별 건수] (정확히 "${PUBLISHER}"가 아닌 것)`,
    ...(publisherLines.length ? publisherLines : ['  없음']),
    '',
    '[파일]',
    `  ${collectedPath}`,
    `  ${excludedPath}`,
    '',
    '※ Excel에서 CSV를 바로 열면 isbn13이 지수(9.79E+12)로 바뀔 수 있습니다.',
    '   데이터 > 텍스트/CSV 가져오기에서 isbn13 열을 텍스트로 지정하고, 저장은 "CSV UTF-8"로 하세요.',
  ].join('\r\n');

  fs.writeFileSync(reportPath, '\uFEFF' + report + '\r\n', 'utf8');
  console.log('\n' + report);
  console.log(`\n보고서: ${reportPath}`);
}

main().catch((err) => {
  console.error('수집 중단:', err.message);
  process.exit(1);
});
