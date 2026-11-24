import { json, readJson, currentUser } from '../_shared/auth.js';

// Each customer can read and save only their own Car Companion data.
// Everything is checked field by field; unknown fields are dropped.

const MAX_ITEMS = 500;
const RECORD_TYPES = ['Tyres', 'Service', 'Repair', 'Other'];
const REMINDER_TYPES = ['Licence disc', 'Service', 'Tyre check', 'Other'];
const LEADS = ['On the due date', '7 days before', '14 days before', '30 days before'];

class Invalid extends Error {}

function text(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Invalid();
  value = value.trim();
  if (value.length > max || (required && !value)) throw new Invalid();
  return value;
}
const oneOf = (value, options) => { if (!options.includes(value)) throw new Invalid(); return value; };
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Invalid();
  const parsed = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Invalid();
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2199) throw new Invalid();
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value)) throw new Invalid();
  return value;
}
function cost(value) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000000) throw new Invalid();
  return String(value).trim();
}
function list(value, clean) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Invalid();
  const items = value.map(item => { if (!item || typeof item !== 'object') throw new Invalid(); return clean(item); });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Invalid();
  return items;
}

function clean(data) {
  if (!data || typeof data !== 'object') throw new Invalid();
  const car = data.car == null ? null : (() => {
    if (typeof data.car !== 'object') throw new Invalid();
    return {
      name: text(data.car.name, 100, true), model: text(data.car.model, 100, true), plate: text(data.car.plate, 100),
      tyre: text(data.car.tyre, 100), roadside: text(data.car.roadside, 100), contact: text(data.car.contact, 100)
    };
  })();
  const records = list(data.records, r => ({
    id: id(r.id), title: text(r.title, 100, true), type: oneOf(r.type, RECORD_TYPES), date: date(r.date),
    cost: cost(r.cost), supplier: text(r.supplier, 100), note: text(r.note, 500)
  }));
  const reminders = list(data.reminders, r => ({
    id: id(r.id), title: text(r.title, 100, true), type: oneOf(r.type, REMINDER_TYPES), date: date(r.date),
    lead: oneOf(r.lead, LEADS), done: r.done === true
  }));
  return { car, records, reminders };
}

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request, 'customer');
  if (!user) return json({ user: null, data: null }); // logged out: the page shows the login screen
  const row = await env.DB.prepare('SELECT data FROM user_data WHERE user_id = ?').bind(user.id).first();
  return json({ user: { email: user.email, role: user.role }, data: row ? JSON.parse(row.data) : null });
}

export async function onRequestPut({ request, env }) {
  const user = await currentUser(env.DB, request, 'customer');
  if (!user) return json({ error: 'Please log in.' }, 401);
  const body = await readJson(request);
  let data;
  try { data = clean(body?.data); } catch (err) {
    if (err instanceof Invalid) return json({ error: 'Some of those details aren’t valid. Please check and try again.' }, 400);
    throw err;
  }
  await env.DB.prepare(
    `INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(user.id, JSON.stringify(data), Date.now()).run();
  return json({ ok: true, data });
}
