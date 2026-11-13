// Data store for the single dock computer (IndexedDB in this browser).
import { db, uid } from './db.js';
import { MASTER_PIN } from './config.js';
import { hashPassword } from './util.js';
import { DEFAULT_SETTINGS, SHIFT_MS, sameBox, totals, renumber, demoLists, DEMO_PEOPLE, DEMO_PASSWORD, dayKey, listCode } from './common.js';

const SESSION_KEY = 'yk.session';

export async function init() {}

// ---------- settings ----------
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await db.get('settings', 'app')) || {}) };
}
export async function saveSettings(patch, actor) {
  const s = { ...(await getSettings()), ...patch, id: 'app' };
  await db.put('settings', s);
  await log(actor, 'settings.update', Object.keys(patch).join(', '));
  return s;
}

// ---------- audit ----------
export async function log(actor, action, detail = '') {
  await db.put('audit', { id: uid('a'), at: Date.now(), by: actor?.id || null, byName: actor?.name || 'System', action, detail });
}
export async function auditTrail(n = 200) {
  return (await db.all('audit')).sort((a, b) => b.at - a.at).slice(0, n);
}

// ---------- people ----------
export async function users() {
  return (await db.all('users')).sort((a, b) => a.name.localeCompare(b.name));
}
export async function hasAdmin() {
  return (await db.all('users')).some(u => u.role === 'admin');
}
async function findUser(login) {
  const u = String(login).trim().toLowerCase();
  return (await db.all('users')).find(x => x.username === u || String(x.empNo).toLowerCase() === u);
}

function assertUnique(all, data) {
  for (const [f, label] of [['empNo', 'Employee no.'], ['username', 'Username'], ['phone', 'Mobile number'], ['aadhaar', 'Aadhaar']]) {
    const v = String(data[f] || '').toLowerCase();
    if (v && all.some(u => u.id !== data.id && String(u[f] || '').toLowerCase() === v)) throw new Error(`${label} ${data[f]} is already used by another account.`);
  }
}

export async function saveUser(data, actor, password) {
  const all = await db.all('users');
  assertUnique(all, data);
  const now = Date.now();
  const existing = data.id ? all.find(u => u.id === data.id) : null;
  const user = existing ? { ...existing, ...data, updatedAt: now, updatedBy: actor?.name } : {
    ...data, id: uid('u'), active: true, createdAt: now,
    createdBy: actor?.id || null, createdByName: actor?.name || 'First-time setup', createdByEmpNo: actor?.empNo || '',
    createdFrom: /Mobile|Android|iPhone/.test(navigator.userAgent) ? 'Phone' : 'Computer',
    mustChangePassword: !!actor
  };
  if (password) Object.assign(user, await hashPassword(password));
  await db.put('users', user);
  await log(actor || user, existing ? 'user.update' : 'user.create', `${user.name} (${user.empNo})`);
  return user;
}

export async function setupAdmin(data, password) {
  await saveUser({ ...data, role: 'admin' }, null, password);
  return login(data.username, password);
}

export async function resetPassword(p, password, actor) {
  const u = await db.get('users', p.id);
  Object.assign(u, await hashPassword(password), { mustChangePassword: true, updatedAt: Date.now(), updatedBy: actor.name });
  await db.put('users', u);
  await log(actor, 'user.reset', `${u.name} (${u.empNo})`);
}

export async function setUserActive(p, active, actor) {
  const u = await db.get('users', p.id);
  u.active = active; u.updatedAt = Date.now(); u.updatedBy = actor.name;
  await db.put('users', u);
  await log(actor, active ? 'user.enable' : 'user.disable', `${u.name} (${u.empNo})`);
}

// ---------- session ----------
const attempts = {};
export async function login(username, password) {
  const key = String(username).toLowerCase();
  const a = attempts[key] || { n: 0, until: 0 };
  if (Date.now() < a.until) throw new Error(`Too many attempts. Try again in ${Math.ceil((a.until - Date.now()) / 1000)} s.`);
  const u = await findUser(username);
  if (!u || (await hashPassword(password, u.salt)).hash !== u.hash) {
    if (++a.n >= 5) { a.until = Date.now() + 30000; a.n = 0; }
    attempts[key] = a;
    throw new Error('Username or password is incorrect.');
  }
  if (!u.active) throw new Error('This account is disabled. Ask your admin to enable it.');
  delete attempts[key];
  const session = { userId: u.id, loginAt: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  u.lastLogin = session.loginAt; await db.put('users', u);
  await log(u, 'auth.login');
  return { user: u, session };
}

export async function currentSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s || Date.now() - s.loginAt > SHIFT_MS) { localStorage.removeItem(SESSION_KEY); return null; }
    const user = await db.get('users', s.userId);
    if (!user || !user.active) { localStorage.removeItem(SESSION_KEY); return null; }
    return { user, session: s };
  } catch { return null; }
}

export async function logout(user) {
  localStorage.removeItem(SESSION_KEY);
  if (user) await log(user, 'auth.logout');
}

export async function changePassword(user, current, next) {
  if (current !== null && (await hashPassword(current, user.salt)).hash !== user.hash) throw new Error('Current password is incorrect.');
  Object.assign(user, await hashPassword(next), { mustChangePassword: false, updatedAt: Date.now() });
  await db.put('users', user);
  await log(user, 'auth.password', user.empNo);
}

// ---------- lists ----------
export async function dispatches() {
  return (await db.all('dispatches')).sort((a, b) => b.createdAt - a.createdAt);
}
export const getDispatch = id => db.get('dispatches', id);
export const watch = () => () => {};

export async function createDispatch(header, user, session) {
  const today = dayKey(Date.now());
  const seq = (await db.all('dispatches')).filter(d => d.code.includes(today)).length + 1;
  const d = totals({
    id: uid('d'), code: listCode(Date.now(), seq), status: 'open', createdAt: Date.now(),
    createdBy: user.id, empName: user.name, empNo: user.empNo, loginAt: session.loginAt,
    ...header, boxes: []
  });
  await db.put('dispatches', d);
  await log(user, 'list.create', d.code);
  return d;
}

async function save(d) { d.updatedAt = Date.now(); totals(d); await db.put('dispatches', d); return d; }

export async function addBox(d, rec, settings, user, via) {
  const fresh = await db.get('dispatches', d.id);
  Object.assign(d, fresh);
  const prev = d.boxes.find(b => sameBox(b, rec));
  if (prev) return { ok: false, reason: 'same', prev };
  if (settings.blockCrossListDuplicates) {
    const other = (await db.all('dispatches')).find(x => x.id !== d.id && x.boxes.some(b => sameBox(b, rec)));
    if (other) return { ok: false, reason: 'other', other };
  }
  const box = { ...rec, seq: d.boxes.length + 1, scannedAt: Date.now(), by: user.name, empNo: user.empNo, via };
  d.boxes.push(box);
  await save(d);
  return { ok: true, box };
}

export async function removeBox(d, box, user) {
  d.boxes = renumber(d.boxes.filter(b => b.key !== box.key));
  await save(d);
  await log(user, 'box.remove', `${box.boxNo || box.key} from ${d.code}`);
}

export async function closeDispatch(d, user, extra = {}) {
  Object.assign(d, extra, { status: 'closed', closedAt: Date.now(), closedBy: user.name });
  await save(d);
  await log(user, 'list.close', `${d.code} · ${d.boxes.length} boxes`);
}

export async function reopenDispatch(d, user) {
  Object.assign(d, { status: 'open', closedAt: null, weightEntered: null });
  await save(d);
  await log(user, 'list.reopen', d.code);
}

export async function deleteDispatch(d, user) {
  await db.del('dispatches', d.id);
  await log(user, 'list.delete', d.code);
}

// ---------- data ----------
export const backup = () => db.exportAll();
export async function restore(data) { await db.importAll(data); await log(null, 'data.import'); }

export async function seedDemo(admin) {
  const people = [];
  for (const p of DEMO_PEOPLE) people.push((await findUser(p.username)) || await saveUser(p, admin, DEMO_PASSWORD));
  const lists = await demoLists(people, await getSettings());
  const counts = {};
  for (const l of lists) {
    const k = dayKey(l.createdAt); counts[k] = (counts[k] || 0) + 1;
    const { user, ...rest } = l;
    await db.put('dispatches', { ...rest, id: uid('d'), code: listCode(l.createdAt, 900 + counts[k]), createdBy: user.id, empName: user.name, empNo: user.empNo });
  }
  await log(admin, 'demo.seed');
}

// ---------- master PIN ----------
// Resets any password from the sign-in screen. The default comes from
// config.js; once changed in Settings, the new one lives on this computer.
const PIN_LOCK = 'yk.pinlock';
async function pinRecord() {
  return (await db.get('settings', 'master')) || MASTER_PIN;
}
async function checkPin(pin) {
  const lock = JSON.parse(localStorage.getItem(PIN_LOCK) || '{"n":0,"until":0}');
  if (Date.now() < lock.until) throw new Error(`Master PIN is locked. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} min.`);
  const rec = await pinRecord();
  const ok = (await hashPassword(String(pin).replace(/\D/g, ''), rec.salt, rec.iterations)).hash === rec.hash;
  if (!ok) {
    lock.n++; if (lock.n >= 5) { lock.until = Date.now() + 10 * 60000; lock.n = 0; }
    localStorage.setItem(PIN_LOCK, JSON.stringify(lock));
    throw new Error('Master PIN is incorrect.');
  }
  localStorage.removeItem(PIN_LOCK);
}

export async function masterReset(login, pin, password) {
  const u = await findUser(login);
  await checkPin(pin);
  if (!u) throw new Error('No account with that username or employee no.');
  Object.assign(u, await hashPassword(password), { mustChangePassword: false, active: true, updatedAt: Date.now(), updatedBy: 'Master PIN' });
  await db.put('users', u);
  await log({ id: u.id, name: 'Master PIN' }, 'user.reset', `${u.name} (${u.empNo})`);
  return u;
}

export async function changeMasterPin(current, next, actor) {
  await checkPin(current);
  const iterations = 310000;
  const { salt, hash } = await hashPassword(String(next).replace(/\D/g, ''), null, iterations);
  await db.put('settings', { id: 'master', salt, hash, iterations, changedAt: Date.now(), changedBy: actor.name });
  await log(actor, 'settings.update', 'master PIN');
}
