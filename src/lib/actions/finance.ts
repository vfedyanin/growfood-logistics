'use server';

import { prisma } from '@/lib/prisma';
import { requireRole, getActorId, RoleName } from '@/lib/authz';
import { revalidatePath } from 'next/cache';

type InvoiceStatus = 'ISSUED' | 'SENT' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED';

const W_FIN: RoleName[] = ['ADMIN', 'LOGISTICS_MANAGER', 'LAAS_MANAGER', 'OWN_DISPATCHER', 'ACCOUNTANT'];

async function nextInvoiceNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `INV-IN-${ymd}-`;
  const last = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
  });
  let n = 1;
  if (last) { const m = last.invoiceNumber.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

const tripInvoiceInclude = {
  trip: { include: { carrier: true, origin: true, destination: true } },
  carrier: true,
};

// Список счетов за перевозки (INCOMING + tripId NOT NULL)
export async function getTripInvoices() {
  await requireRole(W_FIN);
  return prisma.invoice.findMany({
    where: { direction: 'INCOMING', tripId: { not: null } },
    include: tripInvoiceInclude,
    orderBy: { invoiceDate: 'desc' },
  });
}

// Рейсы, для которых ещё нет счёта (есть перевозчик и actualCost), для выбора в форме
export async function getTripsEligibleForInvoice() {
  await requireRole(W_FIN);
  const trips = await prisma.trip.findMany({
    where: {
      carrierId: { not: null },
      invoices: { none: { direction: 'INCOMING' } },
    },
    include: { carrier: true, origin: true, destination: true },
    orderBy: { plannedDeparture: 'desc' },
  });
  return trips.map((t) => ({
    value: t.id,
    label: `${t.tripNumber} · ${t.carrier?.name || '—'} · ${t.origin?.name || '—'} → ${t.destination?.name || '—'}`,
    actualCost: t.actualCost ? Number(t.actualCost) : null,
    vatRatePct: t.vatRatePct ?? 0,
  }));
}

// Создать счёт для рейса. Если payload.amount не задан — берём trip.actualCost.
export async function createTripInvoice(payload: {
  tripId: string;
  invoiceNumber?: string;
  carrierInvoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
}) {
  await requireRole(W_FIN);
  const actor = await getActorId();
  const trip = await prisma.trip.findUnique({
    where: { id: payload.tripId },
    include: { carrier: true },
  });
  if (!trip) throw new Error('Рейс не найден');
  if (!trip.carrierId) throw new Error('У рейса не задан перевозчик');
  const existing = await prisma.invoice.findFirst({
    where: { tripId: trip.id, direction: 'INCOMING' },
  });
  if (existing) throw new Error('У этого рейса уже есть счёт за перевозку');
  const amount = payload.amount != null ? payload.amount : (trip.actualCost ? Number(trip.actualCost) : 0);
  const vatRate = trip.vatRatePct ?? 0;
  const vatAmount = vatRate > 0 ? Math.round((amount * vatRate / (100 + vatRate)) * 100) / 100 : 0;
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: payload.invoiceNumber?.trim() || (await nextInvoiceNumber()),
      carrierInvoiceNumber: payload.carrierInvoiceNumber?.trim() || null,
      invoiceDate: payload.invoiceDate ? new Date(payload.invoiceDate) : new Date(),
      direction: 'INCOMING',
      carrierId: trip.carrierId,
      tripId: trip.id,
      amount,
      vatAmount,
      total: amount,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      status: 'ISSUED',
      notes: payload.notes || null,
      createdById: actor,
      updatedById: actor,
    },
  });
  revalidatePath('/finance/carrier-invoices');
  return inv;
}

export async function updateTripInvoice(id: string, payload: {
  invoiceNumber?: string;
  carrierInvoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  status?: InvoiceStatus;
  notes?: string | null;
}) {
  await requireRole(W_FIN);
  const actor = await getActorId();
  const data: any = { updatedById: actor };
  if (payload.invoiceNumber !== undefined) data.invoiceNumber = (payload.invoiceNumber || '').trim();
  if (payload.carrierInvoiceNumber !== undefined) data.carrierInvoiceNumber = (payload.carrierInvoiceNumber || '').trim() || null;
  if (payload.invoiceDate !== undefined) data.invoiceDate = payload.invoiceDate ? new Date(payload.invoiceDate) : new Date();
  if (payload.amount !== undefined && payload.amount !== null) { data.amount = payload.amount; data.total = payload.amount; }
  if (payload.dueDate !== undefined) data.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.notes !== undefined) data.notes = payload.notes;
  await prisma.invoice.update({ where: { id }, data });
  revalidatePath('/finance/carrier-invoices');
}

export async function deleteTripInvoice(id: string) {
  await requireRole(W_FIN);
  // Запрещаем удалять оплаченные/частично оплаченные
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
  if (!inv) throw new Error('Счёт не найден');
  if (inv.payments.length > 0) throw new Error('Сначала удалите связанные платежи');
  await prisma.invoice.delete({ where: { id } });
  revalidatePath('/finance/carrier-invoices');
}
