export const DENOMINATIONS = [50000, 10000, 5000, 1000] as const;
export type Denomination = typeof DENOMINATIONS[number];
export type Bills = Record<Denomination, number>;
export type Side = 'groom' | 'bride';
export const GUEST_CATEGORIES = ['신랑', '신부', '신랑모', '신랑부', '신부모', '신부부', '기타'] as const;
export type GuestCategory = typeof GUEST_CATEGORIES[number] | '';
export interface Tickets { adult: number; child: number }
export interface ReceiptRecord {
  id: string;
  sequence: number;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
  bills: Bills;
  tickets: Tickets;
  name: string;
  affiliation: string;
  category: GuestCategory;
  memo: string;
}
export interface Settlement {
  status: 'open' | 'matched' | 'discrepancy' | 'needs-review';
  actualBills: Record<Denomination, number | null>;
  initialTickets: { adult: number | null; child: number | null };
  remainingTickets: { adult: number | null; child: number | null };
  reason: string;
  completedAt: string | null;
}
export interface Ledger {
  schemaVersion: 1;
  id: string;
  revision: number;
  event: { title: string; date: string; side: Side };
  nextSequence: number;
  records: ReceiptRecord[];
  settlement: Settlement;
  createdAt: string;
  updatedAt: string;
}
export interface Summary {
  count: number;
  envelopeCount: number;
  ticketsOnlyCount: number;
  amount: number;
  bills: Bills;
  tickets: Tickets;
  organizedCount: number;
}
