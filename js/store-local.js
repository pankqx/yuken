// Data store for the single dock computer (IndexedDB in this browser).
import { db, uid, STORES } from './db.js';
import { MASTER_PIN } from './config.js';
import { hashPassword } from './util.js';
import { parseScan } from './parse.js';
import { ADMIN } from './config.js';
import { fillMissing, DEFAULT_SETTINGS, SHIFT_MS, sameBox, totals, renumber, demoLists, DEMO_PEOPLE, DEMO_PASSWORD, dayKey, listCode } from './common.js';

const SESSION_KEY = 'yk.session';

// Roles: 'super' (the admin — full control), 'manager' (bosses — look, never
// change), 'employee' (loaders and other workers — scan their own lists).
export const isAdmin = u => u?.role === 'manager' || u?.role === 'super';   // can see everything
export const isSuper = u => u?.role === 'super';                            // can change everything

let ready;
const ADMIN_ID = 'u-admin';
const ADMIN_LOCK = 'yk.adminlock';
async function ensureAdmin() {
  let u = await db.get('users', ADMIN_ID);
  if (u && u.name !== ADMIN.name) { u.name = ADMIN.name; u.googleEmail = null; await db.put('users', u); }
  if (!u) {
    u = { id: ADMIN_ID, role: 'super', name: ADMIN.name, username: 'admin', empNo: 'ADMIN', designation: 'Administrator', active: true, createdAt: Date.now(), createdBy: 'system' };
    await db.put('users', u);
  }
  return u;
}
const adminRecord = async () => (await db.get('settings', 'adminpw')) || ADMIN;

// Admin sign-in: the admin password only. Five wrong tries lock it for 10 minutes.
export async function adminLogin(password) {
  const lock = JSON.parse(localStorage.getItem(ADMIN_LOCK) || '{"n":0,"until":0}');
  if (Date.now() < lock.until) throw new Error(`Too many wrong tries. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} min.`);
  const rec = await adminRecord();
  if ((await hashPassword(String(password), rec.salt, rec.iterations)).hash !== rec.hash) {
    lock.n++; if (lock.n >= 5) { lock.until = Date.now() + 10 * 60000; lock.n = 0; }
    localStorage.setItem(ADMIN_LOCK, JSON.stringify(lock));
    throw new Error('Admin password is incorrect.');
  }
  localStorage.removeItem(ADMIN_LOCK);
  return startSession(await ensureAdmin(), 'password');
}
async function setAdminPassword(next, by) {
  const iterations = 310000;
  const { salt, hash } = await hashPassword(String(next), null, iterations);
  await db.put('settings', { id: 'adminpw', salt, hash, iterations, changedAt: Date.now(), changedBy: by });
}
export async function changeAdminPassword(current, next, actor) {
  const rec = await adminRecord();
  if ((await hashPassword(String(current), rec.salt, rec.iterations)).hash !== rec.hash) throw new Error('Current admin password is incorrect.');
  await setAdminPassword(next, actor.name);
  await log(actor, 'user.update', 'changed the admin password');
}
export const init = () => (ready ||= migrate());
async function migrate() {
  const all = await db.all('users');
  // Only one admin exists: the built-in the admin account (ADMIN_ID). Any other
  // admin from older versions or testing is turned into a disabled manager.
  for (const u of all) {
    if (u.role === 'admin' || (u.role === 'super' && u.id !== ADMIN_ID)) {
      if (u.role === 'super') u.active = false;
      u.role = 'manager';
      await db.put('users', u);
    }
  }
  // Weights read by the old parser are read again from the saved label text.
  if (!(await db.get('settings', 'migr-weight-2'))) {
    for (const d of await db.all('dispatches')) {
      let changed = false;
      d.boxes = d.boxes.map(b => {
        if (b.weightBy) return b;           // typed in by hand — keep
        const w = parseScan(b.raw || '')?.weight ?? null;
        if (w !== (b.weight ?? null)) { changed = true; return { ...b, weight: w }; }
        return b;
      });
      if (changed) { totals(d); await db.put('dispatches', d); }
    }
    await db.put('settings', { id: 'migr-weight-2', at: Date.now() });
  }
}

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
// Only the super admin edits the activity log. Each change leaves its own line.
export async function addNote(actor, text, at) {
  await db.put('audit', { id: uid('a'), at: at || Date.now(), by: actor.id, byName: actor.name, action: 'note', detail: text, addedBy: actor.name });
}
export async function editAudit(id, patch, actor) {
  const a = await db.get('audit', id); if (!a) return;
  Object.assign(a, patch, { editedAt: Date.now(), editedBy: actor.name });
  await db.put('audit', a);
}
export async function deleteAudit(id, actor) {
  const a = await db.get('audit', id); if (!a) return;
  await db.del('audit', id);
  await log(actor, 'audit.delete', `${a.byName}: ${a.action}${a.detail ? ' ' + a.detail : ''}`);
}

// ---------- people ----------
export async function users() {
  return (await db.all('users')).sort((a, b) => a.name.localeCompare(b.name));
}
export async function hasAdmin() {
  return (await db.all('users')).some(isAdmin);
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
  if (data.role === 'super' && data.id !== ADMIN_ID) throw new Error('There is only one admin: the admin.');
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



export async function resetPassword(p, password, actor) {
  const u = await db.get('users', p.id);
  Object.assign(u, await hashPassword(password), { needsPassword: false, mustChangePassword: true, updatedAt: Date.now(), updatedBy: actor.name });
  await db.put('users', u);
  await log(actor, 'user.reset', `${u.name} (${u.empNo})`);
}

export async function deleteUser(p, actor) {
  if (p.role === 'super') throw new Error('The admin account cannot be deleted.');
  await db.del('users', p.id);
  await log(actor, 'user.delete', `${p.name} (${p.empNo})`);
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
  if (u?.role === 'super') throw new Error('Username or password is incorrect.');
  if (u && (u.needsPassword || !u.hash)) throw new Error('No password yet. Open your tab on the sign-in screen and choose one.');
  if (!u || (await hashPassword(password, u.salt)).hash !== u.hash) {
    if (++a.n >= 5) { a.until = Date.now() + 30000; a.n = 0; }
    attempts[key] = a;
    throw new Error('Username or password is incorrect.');
  }
  if (!u.active) throw new Error('This account is disabled. Ask the admin to enable it.');
  delete attempts[key];
  return startSession(u, 'password');
}

// Manager tabs on the sign-in screen: names only, nothing sensitive.
export async function managersForLogin() {
  return (await db.all('users')).filter(u => u.role === 'manager' && u.active)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(u => ({ id: u.id, name: u.name, username: u.username, designation: u.designation, needsPassword: !!u.needsPassword || !u.hash }));
}
// A manager the admin created chooses their own password the first time.
export async function firstPassword(id, password) {
  const u = await db.get('users', id);
  if (!u || u.role !== 'manager' || !(u.needsPassword || !u.hash)) throw new Error('This account already has a password. Sign in with it.');
  Object.assign(u, await hashPassword(password), { needsPassword: false, mustChangePassword: false, updatedAt: Date.now(), updatedBy: u.name });
  await db.put('users', u);
  await log(u, 'user.update', 'set own password');
  return startSession(u, 'password');
}

// Google sign-in: the Gmail address must be linked to an account first.
export async function loginGoogle(email) {
  const e = String(email || '').toLowerCase();
  if ((ADMIN.emails || [ADMIN.email]).map(x => x.toLowerCase()).includes(e)) return startSession(await ensureAdmin(), 'google');
  const u = (await db.all('users')).find(x => x.googleEmail === e);
  if (!u) throw Object.assign(new Error(`${email} is not linked to an account yet.`), { code: 'unlinked', email: e });
  if (!u.active) throw new Error('This account is disabled.');
  return startSession(u, 'google');
}
export async function linkGoogle(user, email) {
  const all = await db.all('users');
  const e = String(email || '').toLowerCase();
  if (e && all.some(x => x.id !== user.id && x.googleEmail === e)) throw new Error(`${email} is already linked to another account.`);
  const u = await db.get('users', user.id);
  u.googleEmail = e || null; await db.put('users', u); Object.assign(user, u);
  await log(user, 'user.update', e ? `linked Google ${e}` : 'removed Google link');
}

async function startSession(u, via) {
  const session = { userId: u.id, loginAt: Date.now(), via };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  u.lastLogin = session.loginAt; await db.put('users', u);
  await log(u, 'auth.login', via === 'google' ? 'with Google' : '');
  return { user: u, session };
}

export async function currentSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s) return null;
    const user = await db.get('users', s.userId);
    if (!user || !user.active) { localStorage.removeItem(SESSION_KEY); return null; }
    // the admin and managers stay signed in until they press Sign out.
    // Employees are signed out after a shift, so the next person signs in fresh.
    if (!isAdmin(user) && Date.now() - s.loginAt > SHIFT_MS) { localStorage.removeItem(SESSION_KEY); await log(user, 'auth.logout', 'shift ended'); return null; }
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
  if (prev) {
    const added = fillMissing(prev, rec);
    if (added.length) { await save(d); return { ok: false, reason: 'filled', prev, added }; }
    return { ok: false, reason: 'same', prev };
  }
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

export async function setBoxWeight(d, box, weight, user) {
  const b = d.boxes.find(x => x.key === box.key); if (!b) return;
  b.weight = weight; b.weightBy = user.name;
  await save(d);
  await log(user, 'box.weight', `${b.boxNo || b.key} on ${d.code}: ${weight ?? '—'} kg`);
}

export async function closeDispatch(d, user, extra = {}) {
  // Recompute from the saved box records at the point of closing so the
  // manifest total always includes every scanned label weight.
  const fresh = await db.get('dispatches', d.id);
  if (fresh) Object.assign(d, fresh);
  delete d.weightEntered;
  totals(d);
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
export async function markBackup(where, user) {
  await db.put('settings', { id: 'lastBackup', at: Date.now(), where, by: user?.name });
  await log(user, 'data.backup', where);
}
export const lastBackup = () => db.get('settings', 'lastBackup');
export async function restore(data) { await db.importAll(data); ready = null; await init(); await log(null, 'data.import'); }

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
  await checkPin(pin);
  // Empty username = the admin password (the admin).
  if (!String(login || '').trim()) {
    await setAdminPassword(password, 'Master PIN');
    await log({ id: ADMIN_ID, name: 'Master PIN' }, 'user.reset', 'admin password');
    return { name: 'the admin (admin)', username: '' };
  }
  const u = await findUser(login);
  if (!u || u.role === 'super') throw new Error('No account with that username or employee no.');
  Object.assign(u, await hashPassword(password), { needsPassword: false, mustChangePassword: false, active: true, updatedAt: Date.now(), updatedBy: 'Master PIN' });
  await db.put('users', u);
  await log({ id: u.id, name: 'Master PIN' }, 'user.reset', `${u.name} (${u.empNo})`);
  return u;
}

// Start fresh: erase every account, list and setting on this device.
export async function eraseAll(pin) {
  await checkPin(pin);
  for (const st of STORES) await db.clear(st);
  ['yk.session', 'yk.who'].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  for (const k of Object.keys(localStorage)) if (k.startsWith('yk.') && k !== 'yk.theme') localStorage.removeItem(k);
  ready = null;
}

export async function changeMasterPin(current, next, actor) {
  await checkPin(current);
  const iterations = 310000;
  const { salt, hash } = await hashPassword(String(next).replace(/\D/g, ''), null, iterations);
  await db.put('settings', { id: 'master', salt, hash, iterations, changedAt: Date.now(), changedBy: actor.name });
  await log(actor, 'settings.update', 'master PIN');
}
