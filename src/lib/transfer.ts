import type ExcelJS from 'exceljs';
import { DENOMINATIONS, GUEST_CATEGORIES, type Bills, type Ledger, type Tickets } from '../types';

const invalid = (detail: string): never => { throw new Error(`백업 파일을 확인해 주세요: ${detail}`); };
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 형식 오류`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !(key in result))) invalid(`${label} 필드 오류`);
  return result;
}
function string(value: unknown, label: string, required = false): asserts value is string {
  if (typeof value !== 'string' || (required && !value.trim())) invalid(`${label} 문자열 오류`);
}
function count(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${label} 수량 오류`);
}
function timestamp(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(`${label} 시각 오류`);
}
function quantities(value: unknown, keys: string[], label: string, nullable = false): void {
  const values = object(value, keys, label);
  keys.forEach(key => count(values[key], label, nullable));
}
function totals(ledger: Ledger) {
  const active = ledger.records.filter(record => !record.deletedAt);
  const bills: Bills = { 50000: 0, 10000: 0, 5000: 0, 1000: 0 };
  const tickets: Tickets = { adult: 0, child: 0 };
  active.forEach(record => {
    DENOMINATIONS.forEach(denomination => { bills[denomination] += record.bills[denomination]; });
    tickets.adult += record.tickets.adult;
    tickets.child += record.tickets.child;
  });
  const amount = DENOMINATIONS.reduce((sum, denomination) => sum + denomination * bills[denomination], 0);
  return { active, bills, tickets, amount };
}

/** Parse completely before returning; this function never changes browser storage. */
export function parseBackup(text: string): Ledger {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid('JSON 형식이 아닙니다.'); }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'exportedAt' in value) {
    timestamp(value.exportedAt, '백업 내보내기');
    const { exportedAt: _exportedAt, ...contents } = value;
    value = contents;
  }
  const ledger = object(value, ['schemaVersion', 'id', 'revision', 'event', 'nextSequence', 'records', 'settlement', 'createdAt', 'updatedAt'], '장부');
  if (ledger.schemaVersion !== 1) invalid('지원하지 않는 백업 버전입니다.');
  string(ledger.id, '장부 ID', true);
  count(ledger.revision, '수정 버전');
  count(ledger.nextSequence, '다음 번호');
  timestamp(ledger.createdAt, '생성');
  timestamp(ledger.updatedAt, '수정');
  const event = object(ledger.event, ['title', 'date', 'side'], '행사');
  string(event.title, '행사명', true);
  if (event.side !== 'groom' && event.side !== 'bride') invalid('신랑측/신부측 구분 오류');
  if (typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !Number.isFinite(Date.parse(event.date)) || new Date(event.date).toISOString().slice(0, 10) !== event.date) invalid('행사 날짜 오류');
  if (!Array.isArray(ledger.records)) invalid('접수 내역 오류');
  const ids = new Set<string>();
  const sequences = new Set<number>();
  let maximum = 0;
  for (const entry of ledger.records as unknown[]) {
    const record = object(entry, ['id', 'sequence', 'createdAt', 'updatedAt', 'deletedAt', 'bills', 'tickets', 'name', 'affiliation', 'category', 'memo'], '접수');
    string(record.id, '접수 ID', true);
    count(record.sequence, '접수 번호');
    const sequence = record.sequence as number;
    if (sequence < 1 || ids.has(record.id) || sequences.has(sequence)) invalid('중복 ID 또는 접수 번호');
    ids.add(record.id); sequences.add(sequence); maximum = Math.max(maximum, sequence);
    timestamp(record.createdAt, '접수'); timestamp(record.updatedAt, '접수 수정', true); timestamp(record.deletedAt, '접수 삭제', true);
    quantities(record.bills, DENOMINATIONS.map(String), '권종');
    quantities(record.tickets, ['adult', 'child'], '식권');
    for (const key of ['name', 'affiliation', 'memo']) string(record[key], key);
    if (record.category !== '' && !GUEST_CATEGORIES.includes(record.category as typeof GUEST_CATEGORIES[number])) invalid('손님 분류 오류');
    const bills = record.bills as Bills; const tickets = record.tickets as Tickets;
    const amount = DENOMINATIONS.reduce((sum, denomination) => sum + bills[denomination] * denomination, 0);
    count(amount, '접수 금액');
    if (amount === 0 && tickets.adult === 0 && tickets.child === 0) invalid('금액과 식권이 모두 0인 접수');
  }
  if ((ledger.nextSequence as number) <= maximum) invalid('다음 번호가 기존 번호보다 커야 합니다.');
  const settlement = object(ledger.settlement, ['status', 'actualBills', 'initialTickets', 'remainingTickets', 'reason', 'completedAt'], '정산');
  if (!['open', 'matched', 'discrepancy', 'needs-review'].includes(settlement.status as string)) invalid('정산 상태 오류');
  quantities(settlement.actualBills, DENOMINATIONS.map(String), '실계수', true);
  quantities(settlement.initialTickets, ['adult', 'child'], '최초 식권', true);
  quantities(settlement.remainingTickets, ['adult', 'child'], '남은 식권', true);
  string(settlement.reason, '차이 사유'); timestamp(settlement.completedAt, '마감', true);
  const result = ledger as unknown as Ledger;
  const summary = totals(result);
  count(summary.amount, '총금액');
  Object.values(summary.bills).forEach(n => count(n, '총 권종'));
  Object.values(summary.tickets).forEach(n => count(n, '총 식권'));
  const actualAmount = DENOMINATIONS.reduce((sum, denomination) => sum + (result.settlement.actualBills[denomination] ?? 0) * denomination, 0);
  count(actualAmount, '실계수 금액');
  for (const key of ['adult', 'child'] as const) {
    const initial = result.settlement.initialTickets[key]; const remaining = result.settlement.remainingTickets[key];
    if (initial !== null && remaining !== null && remaining > initial) invalid('남은 식권이 최초 수량보다 많습니다.');
  }
  if (settlement.status === 'open' && settlement.completedAt !== null) invalid('미마감 정산의 마감 시각 오류');
  if (settlement.status === 'matched' || settlement.status === 'discrepancy') {
    if (settlement.completedAt === null || [...Object.values(result.settlement.actualBills), ...Object.values(result.settlement.initialTickets), ...Object.values(result.settlement.remainingTickets)].some(n => n === null)) invalid('마감된 정산에 누락된 실계수가 있습니다.');
    const difference = DENOMINATIONS.some(denomination => result.settlement.actualBills[denomination] !== summary.bills[denomination]) || (['adult', 'child'] as const).some(key => result.settlement.initialTickets[key]! - result.settlement.remainingTickets[key]! !== summary.tickets[key]);
    if (settlement.status === 'matched' && difference) invalid('차이 없음 상태와 실제 집계가 다릅니다.');
    if (settlement.status === 'discrepancy' && (!difference || !result.settlement.reason.trim())) invalid('차이 있음 상태에는 실제 차이와 사유가 필요합니다.');
  }
  return result;
}

export function serializeBackup(ledger: Ledger): string {
  const text = JSON.stringify({ ...ledger, exportedAt: new Date().toISOString() }, null, 2);
  parseBackup(text);
  return text;
}
function filename(ledger: Ledger, label: string, extension: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `축의금_${ledger.event.side === 'groom' ? '신랑측' : '신부측'}_${ledger.event.date}_${label}_${stamp}.${extension}`;
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function downloadBackup(ledger: Ledger): void {
  download(new Blob([serializeBackup(ledger)], { type: 'application/json' }), filename(ledger, '백업', 'json'));
}
export async function shareBackup(ledger: Ledger): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([serializeBackup(ledger)], filename(ledger, '백업', 'json'), { type: 'application/json' });
  if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
    downloadBackup(ledger); return 'downloaded';
  }
  try { await navigator.share({ files: [file], title: `${ledger.event.title} 축의금 백업` }); return 'shared'; }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    if (error instanceof Error && error.name === 'NotSupportedError') { downloadBackup(ledger); return 'downloaded'; }
    throw error;
  }
}

/** Exposed for verifying the actual workbook without invoking a browser download. */
export async function buildExcelWorkbook(ledger: Ledger, kind: 'settlement' | 'final'): Promise<ExcelJS.Workbook> {
  parseBackup(JSON.stringify(ledger));
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '축의금 접수·정산'; workbook.created = new Date();
  const { active, bills, tickets, amount } = totals(ledger);
  const settlement = ledger.settlement;
  const status = { open: '미마감', matched: '차이 없음 · 마감', discrepancy: '차이 있음 · 마감', 'needs-review': '재확인 필요 · 접수 변경됨' }[settlement.status];
  const sum = workbook.addWorksheet('정산 요약');
  sum.addRows([
    ['행사명', ledger.event.title], ['행사일', ledger.event.date], ['장부', ledger.event.side === 'groom' ? '신랑측' : '신부측'],
    ['정산 상태', status], ['마감 시각', settlement.completedAt ?? '미마감'], ['내보낸 시각', new Date().toISOString()],
    ['총 접수 건수', active.length], ['현금 봉투 수', active.filter(record => DENOMINATIONS.some(d => record.bills[d] > 0)).length],
    ['식권만 지급 건수', active.filter(record => DENOMINATIONS.every(d => record.bills[d] === 0)).length],
    ['이름 입력 완료', active.filter(record => record.name.trim()).length], ['이름 미입력', active.filter(record => !record.name.trim()).length],
    ['기록 총금액', amount], ['차이 사유', settlement.reason || '없음'],
    ['안내', settlement.status === 'needs-review' ? '접수 변경 전 실계수입니다. 현재 기록 기준 차이를 표시하며 재정산이 필요합니다.' : settlement.status === 'open' ? '정산이 마감되지 않았습니다. 미입력 실계수는 빈 칸으로 표시합니다.' : '차이 = 실제 - 기록'], [],
    ['권종', '기록 장수', '실제 장수', '장수 차이', '기록 금액', '실제 금액', '금액 차이'],
  ]);
  for (const denomination of DENOMINATIONS) {
    const actual = settlement.actualBills[denomination];
    sum.addRow([denomination, bills[denomination], actual, actual === null ? null : actual - bills[denomination], denomination * bills[denomination], actual === null ? null : denomination * actual, actual === null ? null : (actual - bills[denomination]) * denomination]);
  }
  const actualComplete = DENOMINATIONS.every(d => settlement.actualBills[d] !== null);
  const actualAmount = actualComplete ? DENOMINATIONS.reduce((n, d) => n + d * settlement.actualBills[d]!, 0) : null;
  sum.addRow(['합계', Object.values(bills).reduce((a, b) => a + b, 0), actualComplete ? Object.values(settlement.actualBills).reduce<number>((a, b) => a + b!, 0) : null, actualComplete ? DENOMINATIONS.reduce((n, d) => n + settlement.actualBills[d]! - bills[d], 0) : null, amount, actualAmount, actualAmount === null ? null : actualAmount - amount]);
  sum.addRow([]); sum.addRow(['식권', '기록 지급량', '최초 수령량', '남은 수량', '실제 지급량', '지급량 차이']);
  for (const key of ['adult', 'child'] as const) {
    const initial = settlement.initialTickets[key]; const remaining = settlement.remainingTickets[key];
    const distributed = initial === null || remaining === null ? null : initial - remaining;
    sum.addRow([key === 'adult' ? '대인' : '소인', tickets[key], initial, remaining, distributed, distributed === null ? null : distributed - tickets[key]]);
  }
  const records = workbook.addWorksheet(kind === 'final' ? '최종 명부' : '접수 내역');
  records.addRow(['번호', '유형', '금액', '대인 식권', '소인 식권', '이름', '소속', '분류', '메모', '이름 입력', '접수 시각', '수정 시각', '5만원 장수', '1만원 장수', '5천원 장수', '1천원 장수']);
  for (const record of [...active].sort((a, b) => a.sequence - b.sequence)) {
    const recordAmount = DENOMINATIONS.reduce((n, d) => n + d * record.bills[d], 0);
    records.addRow([`${ledger.event.side === 'groom' ? '신랑' : '신부'}-${String(record.sequence).padStart(3, '0')}`, recordAmount ? '현금 봉투' : '식권만 지급', recordAmount, record.tickets.adult, record.tickets.child, record.name, record.affiliation, record.category, record.memo, record.name.trim() ? '완료' : '미입력', record.createdAt, record.updatedAt, ...DENOMINATIONS.map(d => record.bills[d])]);
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: sheet === sum ? 0 : 1 }];
    sheet.columns.forEach((column, index) => { column.width = index === 0 ? 24 : 20; });
    sheet.eachRow(row => {
      row.alignment = { vertical: 'middle', wrapText: true }; row.height = 30;
      row.eachCell(cell => { if (typeof cell.value === 'number') cell.numFmt = '#,##0'; });
    });
    sheet.getRow(sheet === sum ? 16 : 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(sheet === sum ? 16 : 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2166D1' } };
  }
  for (const row of [1, 4, 5, 6, 13, 14]) sum.mergeCells(`B${row}:G${row}`);
  sum.getRow(13).height = 45; sum.getRow(14).height = 45;
  records.getColumn(9).width = 36;
  records.autoFilter = { from: 'A1', to: 'P1' };
  return workbook;
}
export async function exportExcel(ledger: Ledger, kind: 'settlement' | 'final'): Promise<void> {
  const workbook = await buildExcelWorkbook(ledger, kind);
  const bytes = await workbook.xlsx.writeBuffer();
  download(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename(ledger, kind === 'final' ? '최종명부' : '현장정산', 'xlsx'));
}
