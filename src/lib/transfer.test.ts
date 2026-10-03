import { describe, expect, it, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { Ledger } from '../types';
import { buildExcelWorkbook, parseBackup, serializeBackup, shareBackup } from './transfer';

function fixture(): Ledger {
  return {
    schemaVersion: 1, id: 'ledger-1', revision: 4, nextSequence: 4,
    event: { title: '결혼식', date: '2026-10-10', side: 'groom' },
    createdAt: '2026-10-10T01:00:00.000Z', updatedAt: '2026-10-10T02:00:00.000Z',
    records: [
      { id: 'receipt-1', sequence: 1, createdAt: '2026-10-10T01:01:00.000Z', updatedAt: null, deletedAt: null, bills: { 50000: 2, 10000: 1, 5000: 0, 1000: 0 }, tickets: { adult: 2, child: 1 }, name: '=HYPERLINK("https://example.com")', affiliation: '회사', category: '신랑', memo: '오랜 친구', },
      { id: 'receipt-2', sequence: 2, createdAt: '2026-10-10T01:02:00.000Z', updatedAt: null, deletedAt: null, bills: { 50000: 0, 10000: 0, 5000: 0, 1000: 0 }, tickets: { adult: 1, child: 0 }, name: '', affiliation: '', category: '', memo: '', },
      { id: 'receipt-3', sequence: 3, createdAt: '2026-10-10T01:03:00.000Z', updatedAt: null, deletedAt: '2026-10-10T01:04:00.000Z', bills: { 50000: 10, 10000: 0, 5000: 0, 1000: 0 }, tickets: { adult: 8, child: 0 }, name: '삭제된 손님', affiliation: '', category: '', memo: '', },
    ],
    settlement: { status: 'discrepancy', actualBills: { 50000: 2, 10000: 0, 5000: 0, 1000: 0 }, initialTickets: { adult: 100, child: 20 }, remainingTickets: { adult: 96, child: 19 }, reason: '1만원 부족, 대인 식권 1장 추가 지급', completedAt: '2026-10-10T02:00:00.000Z' },
  };
}

describe('backup validation', () => {
  it('round-trips deleted records and discrepancy data without mutating the source', () => {
    const ledger = fixture(); const original = structuredClone(ledger);
    expect(parseBackup(serializeBackup(ledger))).toEqual(ledger);
    expect(ledger).toEqual(original);
  });
  it('normalizes an optional export timestamp', () => {
    const ledger = fixture();
    expect(parseBackup(JSON.stringify({ ...ledger, exportedAt: ledger.updatedAt }))).toEqual(ledger);
  });
  it.each([
    ['unsupported version', (l: Ledger) => { (l as unknown as { schemaVersion: number }).schemaVersion = 2; }],
    ['duplicate id', (l: Ledger) => { l.records[1].id = l.records[0].id; }],
    ['duplicate sequence', (l: Ledger) => { l.records[1].sequence = l.records[0].sequence; }],
    ['deleted sequence reuse', (l: Ledger) => { l.nextSequence = 3; }],
    ['unsafe quantity', (l: Ledger) => { l.records[0].bills[50000] = Number.MAX_SAFE_INTEGER; }],
    ['negative tickets', (l: Ledger) => { l.records[0].tickets.child = -1; }],
    ['fractional count', (l: Ledger) => { l.records[0].tickets.adult = 0.5; }],
    ['invalid category', (l: Ledger) => { l.records[0].category = '친구' as never; }],
    ['invalid calendar day', (l: Ledger) => { l.event.date = '2026-02-30'; }],
    ['false matched state', (l: Ledger) => { l.settlement.status = 'matched'; }],
    ['missing actual count', (l: Ledger) => { l.settlement.actualBills[1000] = null; }],
    ['missing discrepancy reason', (l: Ledger) => { l.settlement.reason = ' '; }],
    ['impossible remaining tickets', (l: Ledger) => { l.settlement.remainingTickets.adult = 101; }],
    ['missing close time', (l: Ledger) => { l.settlement.completedAt = null; }],
  ])('rejects %s', (_name, corrupt) => {
    const ledger = fixture(); corrupt(ledger);
    expect(() => parseBackup(JSON.stringify(ledger))).toThrow('백업 파일');
  });
  it('rejects a receipt with no cash and no tickets', () => {
    const ledger = fixture(); ledger.records[1].tickets.adult = 0;
    expect(() => parseBackup(JSON.stringify(ledger))).toThrow('모두 0');
  });
});

describe('Excel contents', () => {
  it.each(['settlement', 'final'] as const)('keeps discrepancies, tickets-only records, and literal names in %s export', async kind => {
    const workbook = await buildExcelWorkbook(fixture(), kind);
    const bytes = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(bytes);
    const summary = loaded.getWorksheet('정산 요약')!;
    const rows = summary.getSheetValues() as unknown[][];
    const find = (label: string | number) => rows.find(row => row?.[1] === label)!;
    expect(find('정산 상태')[2]).toBe('차이 있음 · 마감');
    expect(find('총 접수 건수')[2]).toBe(2);
    expect(find('현금 봉투 수')[2]).toBe(1);
    expect(find('식권만 지급 건수')[2]).toBe(1);
    expect(find('기록 총금액')[2]).toBe(110000);
    expect(find('차이 사유')[2]).toBe(fixture().settlement.reason);
    expect(find(10000).slice(2, 8)).toEqual([1, 0, -1, 10000, 0, -10000]);
    expect(find('합계').slice(5, 8)).toEqual([110000, 100000, -10000]);
    expect(find('대인').slice(2, 7)).toEqual([3, 100, 96, 4, 1]);
    expect(find('소인').slice(2, 7)).toEqual([1, 20, 19, 1, 0]);
    const records = loaded.getWorksheet(kind === 'final' ? '최종 명부' : '접수 내역')!;
    expect(records.rowCount).toBe(3);
    expect(records.getCell('F2').value).toBe(fixture().records[0].name);
    expect(records.getCell('F2').type).toBe(ExcelJS.ValueType.String);
    expect(records.getCell('B3').value).toBe('식권만 지급');
  });
  it('labels stale real counts honestly and never turns missing values into zero', async () => {
    const ledger = fixture(); ledger.settlement.status = 'needs-review'; ledger.settlement.completedAt = null; ledger.settlement.actualBills[50000] = null;
    const workbook = await buildExcelWorkbook(ledger, 'final');
    const summary = workbook.getWorksheet('정산 요약')!;
    expect(summary.getCell('B4').value).toContain('재확인 필요');
    expect(summary.getCell('B14').value).toContain('변경 전');
    expect(summary.getCell('C17').value).toBeNull();
    expect(summary.getCell('F21').value).toBeNull();
  });
});

describe('sharing', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('returns cancellation without initiating download', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: async () => { throw new DOMException('cancelled', 'AbortError'); } });
    expect(await shareBackup(fixture())).toBe('cancelled');
  });
  it('surfaces permission failures instead of claiming a successful fallback', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
    await expect(shareBackup(fixture())).rejects.toThrow('denied');
  });
});
