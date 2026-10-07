import { ValidationError, randomHex } from './util.js';
import { text } from './catalog.js';
import { isEmail } from './mail.js';
import { SHOWROOMS } from './orders.js';

// Hourly slots while the showrooms are open (10 AM – 8:30 PM)
export const SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
export const BOOKING_STATUSES = ['booked', 'visited', 'cancelled', 'no_show'];
const PER_SLOT = 3; // visitors per showroom per slot
const DAYS_AHEAD = 30;
const MIN_NOTICE_MS = 60 * 60 * 1000; // book at least an hour ahead

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDate(ms = Date.now()) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The moment a slot starts, as a timestamp (slots are Indian time)
function slotStart(date, slot) {
  return Date.parse(`${date}T${slot}:00+05:30`);
}

export function tomorrowIST() {
  return istDate(Date.now() + 24 * 60 * 60 * 1000);
}

export function bookableDates() {
  return Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => istDate(Date.now() + i * 24 * 60 * 60 * 1000));
}

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && bookableDates().includes(date);
}

async function slotCounts(db, showroom, date) {
  const { results } = await db
    .prepare("SELECT slot, COUNT(*) AS n FROM bookings WHERE showroom = ? AND date = ? AND status = 'booked' GROUP BY slot")
    .bind(showroom, date)
    .all();
  return Object.fromEntries(results.map((r) => [r.slot, r.n]));
}

/**
 * Open slots for a showroom on a date.
 */
export async function availability(db, showroom, date) {
  if (!SHOWROOMS.includes(showroom)) throw new ValidationError('Choose a showroom');
  if (!validDate(date)) throw new ValidationError(`Choose a date within the next ${DAYS_AHEAD} days`);
  const counts = await slotCounts(db, showroom, date);
  const now = Date.now();
  return {
    showroom,
    date,
    slots: SLOTS.map((time) => ({
      time,
      available: slotStart(date, time) - now >= MIN_NOTICE_MS && (counts[time] || 0) < PER_SLOT,
    })),
  };
}

function singleLine(value, max) {
  return text(value, 1000).replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function newBookingId(date) {
  return `BK-${date.slice(2).replace(/-/g, '')}-${randomHex(2).toUpperCase()}`;
}

/**
 * Validate and save a booking. The slot is re-checked at save time, so it can't be overbooked.
 */
export async function createBooking(db, body) {
  const showroom = body?.showroom;
  const date = body?.date;
  const slot = body?.slot;
  const { slots } = await availability(db, showroom, date);
  if (!SLOTS.includes(slot)) throw new ValidationError('Choose a time');
  if (!slots.find((s) => s.time === slot)?.available) throw new ValidationError('That time is no longer available. Please pick another.');

  const name = singleLine(body.name, 80);
  const phone = singleLine(body.phone, 20).replace(/[^\d+]/g, '');
  const email = singleLine(body.email, 120);
  if (!name) throw new ValidationError('Please enter your name');
  if (!/^(\+?91)?[6-9]\d{9}$/.test(phone)) throw new ValidationError('Please enter a valid 10-digit mobile number');
  if (email && !isEmail(email)) throw new ValidationError('Please enter a valid email address');

  // One person can hold at most 3 upcoming visits
  const { upcoming } = await db
    .prepare("SELECT COUNT(*) AS upcoming FROM bookings WHERE status = 'booked' AND date >= ? AND json_extract(data, '$.phone') = ?")
    .bind(istDate(), phone)
    .first();
  if (upcoming >= 3) throw new ValidationError('You already have 3 upcoming visits booked. Please call or WhatsApp us to change them.');

  const booking = {
    id: newBookingId(date),
    createdAt: new Date().toISOString(),
    showroom,
    date,
    slot,
    name,
    phone,
    email,
    notes: text(body.notes, 500).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ''),
    status: 'booked',
  };
  // Insert only while the slot still has room (two people can't take the last place)
  const { meta } = await db
    .prepare(
      `INSERT INTO bookings (id, date, showroom, slot, status, data)
       SELECT ?1, ?2, ?3, ?4, 'booked', ?5
       WHERE (SELECT COUNT(*) FROM bookings WHERE showroom = ?3 AND date = ?2 AND slot = ?4 AND status = 'booked') < ?6`,
    )
    .bind(booking.id, date, showroom, slot, JSON.stringify(booking), PER_SLOT)
    .run();
  if (meta.changes === 0) throw new ValidationError('That time was just taken. Please pick another.');
  return booking;
}

export async function getBookings(db) {
  const { results } = await db.prepare('SELECT data FROM bookings ORDER BY date DESC, slot DESC').all();
  return results.map((row) => JSON.parse(row.data));
}

export async function getBookingsOn(db, date) {
  const { results } = await db
    .prepare("SELECT data FROM bookings WHERE date = ? AND status = 'booked' ORDER BY slot, showroom")
    .bind(date)
    .all();
  return results.map((row) => JSON.parse(row.data));
}

export async function updateBooking(db, id, updates) {
  const row = await db.prepare('SELECT data FROM bookings WHERE id = ?').bind(id).first();
  if (!row) return null;
  const next = { ...JSON.parse(row.data) };
  if (updates.status !== undefined) {
    if (!BOOKING_STATUSES.includes(updates.status)) throw new ValidationError('Unknown booking status');
    next.status = updates.status;
  }
  if (updates.adminNote !== undefined) next.adminNote = text(updates.adminNote, 1000);
  next.updatedAt = new Date().toISOString();
  await db.prepare('UPDATE bookings SET status = ?, data = ? WHERE id = ?').bind(next.status, JSON.stringify(next), id).run();
  return next;
}

export async function markReminderSent(db, id) {
  await db.prepare("UPDATE bookings SET data = json_set(data, '$.reminderSent', 1) WHERE id = ?").bind(id).run();
}
