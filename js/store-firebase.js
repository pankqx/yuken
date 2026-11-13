// Cloud store: Firebase Auth + Cloud Firestore (free Spark plan).
//
// Collections
//   meta/setup            who the first admin is (public read: tells the app setup is done)
//   logins/{key}          username / employee no. → sign-in email (public read, admin write)
//   members/{authUid}     role + active flag, used by the security rules
//   users/{profileId}     employee record
//   dispatches/{id}       loading lists with their boxes
//   boxkeys/{key}         one doc per loaded box — makes "already loaded" atomic across phones
//   counters/{yyyymmdd}   list numbering per day
//   audit/{id}            activity log
//   settings/app          header, transporters, locations, rules
import {
  initializeApp, deleteApp, initializeAuth, browserLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, onSnapshot, runTransaction, writeBatch
} from '../vendor/firebase.js';
import { firebaseConfig } from './config.js';
import { DEFAULT_SETTINGS, SHIFT_MS, sameBox, boxIds, totals, renumber, clean, demoLists, DEMO_PEOPLE, DEMO_PASSWORD, dayKey, listCode } from './common.js';

export const mode = 'cloud';
const SESSION_KEY = 'yk.cloud.session';
const MAIL_DOMAIN = 'yukenpol.app'; // sign-in addresses are internal; nothing is ever emailed

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: browserLocalPersistence });
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const ref = (c, id) => doc(fs, c, id);
const newId = c => doc(collection(fs, c)).id;
const all = async c => (await getDocs(collection(fs, c))).docs.map(d => ({ id: d.id, ...d.data() }));
const keyId = k => 'k_' + encodeURIComponent(k).replace(/\./g, '%2E').slice(0, 1400);
const emailFor = (username, gen) => `${username}.${gen}@${MAIL_DOMAIN}`;

let me = null; // { authUid, profileId, role }

const ready = new Promise(res => { const off = onAuthStateChanged(auth, u => { off(); res(u); }); });
export async function init() { await ready; }

function friendly(err) {
  const c = err?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return new Error('Username or password is incorrect.');
  if (/too-many-requests/.test(c)) return new Error('Too many attempts. Wait a minute and try again.');
  if (/network-request-failed|unavailable/.test(c)) return new Error('No internet connection. Check Wi-Fi or mobile data and try again.');
  if (/permission-denied/.test(c)) return new Error('You do not have access to do that.');
  if (/weak-password/.test(c)) return new Error('That password is too weak.');
  return err instanceof Error ? err : new Error(String(err));
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { throw friendly(e); } };

// Creates a sign-in account without signing the admin out: a throwaway
// second Firebase app does the sign-up.
async function createAuthAccount(email, password) {
  const tmp = initializeApp(firebaseConfig, 'create-' + Date.now());
  try {
    const a = initializeAuth(tmp, { persistence: inMemoryPersistence });
    const cred = await createUserWithEmailAndPassword(a, email, password);
    await signOut(a);
    return cred.user.uid;
  } finally { await deleteApp(tmp); }
}

// ---------- settings ----------
export const getSettings = guard(async () => {
  if (!auth.currentUser) return { ...DEFAULT_SETTINGS };
  const s = await getDoc(ref('settings', 'app'));
  return { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
});
export const saveSettings = guard(async (patch, actor) => {
  await setDoc(ref('settings', 'app'), clean(patch), { merge: true });
  await log(actor, 'settings.update', Object.keys(patch).join(', '));
  return getSettings();
});

// ---------- audit ----------
export async function log(actor, action, detail = '') {
  if (!auth.currentUser) return;
  try { await setDoc(ref('audit', newId('audit')), { at: Date.now(), by: actor?.id || null, byName: actor?.name || 'System', byUid: auth.currentUser.uid, action, detail }); }
  catch { /* logging must never block work */ }
}
export const auditTrail = guard(async (n = 200) => (await all('audit')).sort((a, b) => b.at - a.at).slice(0, n));

// ---------- people ----------
export const users = guard(async () => (await all('users')).sort((a, b) => a.name.localeCompare(b.name)));
export const hasAdmin = guard(async () => (await getDoc(ref('meta', 'setup'))).exists());

async function assertFree(data) {
  for (const k of [data.username, data.empNo].map(v => String(v || '').toLowerCase()).filter(Boolean)) {
    const l = await getDoc(ref('logins', k));
    if (l.exists() && l.data().profileId !== data.id) throw new Error(`"${k}" is already used to sign in by another account.`);
  }
  const people = await all('users');
  for (const [f, label] of [['phone', 'Mobile number'], ['aadhaar', 'Aadhaar'], ['empNo', 'Employee no.']]) {
    const v = String(data[f] || '').toLowerCase();
    if (v && people.some(u => u.id !== data.id && String(u[f] || '').toLowerCase() === v)) throw new Error(`${label} ${data[f]} is already used by another account.`);
  }
}

const stamp = actor => ({
  createdAt: Date.now(), createdBy: actor?.id || null, createdByName: actor?.name || 'First-time setup', createdByEmpNo: actor?.empNo || '',
  createdFrom: /Mobile|Android|iPhone/.test(navigator.userAgent) ? 'Phone' : 'Computer'
});

export const setupAdmin = guard(async (data, password) => {
  if (await hasAdmin()) throw new Error('Setup is already done. Sign in instead.');
  const profileId = newId('users');
  const email = emailFor(data.username, 1);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const profile = clean({ ...data, id: profileId, role: 'admin', active: true, authUid: uid, email, gen: 1, mustChangePassword: false, lastLogin: Date.now(), ...stamp(null) });
  const b = writeBatch(fs);
  b.set(ref('meta', 'setup'), { adminUid: uid, at: Date.now() });
  b.set(ref('members', uid), { profileId, role: 'admin', active: true });
  b.set(ref('users', profileId), profile);
  b.set(ref('logins', data.username.toLowerCase()), { email, profileId });
  b.set(ref('logins', data.empNo.toLowerCase()), { email, profileId });
  b.set(ref('settings', 'app'), clean(DEFAULT_SETTINGS));
  await b.commit();
  me = { authUid: uid, profileId, role: 'admin' };
  const session = { loginAt: Date.now(), uid };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await log(profile, 'user.create', `${profile.name} (${profile.empNo})`);
  return { user: profile, session };
});

export const saveUser = guard(async (data, actor, password) => {
  data = { ...data, username: data.username.toLowerCase() };
  await assertFree(data);
  const b = writeBatch(fs);
  let user;
  if (data.id) {
    const old = (await getDoc(ref('users', data.id))).data();
    user = clean({ ...old, ...data, updatedAt: Date.now(), updatedBy: actor?.name });
    // Moved sign-in names: drop the old ones, point the new ones at the account.
    for (const k of [old.username, old.empNo].map(v => String(v).toLowerCase())) if (![user.username, user.empNo.toLowerCase()].includes(k)) b.delete(ref('logins', k));
    for (const k of [user.username, user.empNo.toLowerCase()]) b.set(ref('logins', k), { email: user.email, profileId: user.id });
    b.update(ref('members', user.authUid), { role: user.role, active: user.active !== false });
  } else {
    const profileId = newId('users');
    const email = emailFor(data.username, 1);
    const uid = await createAuthAccount(email, password);
    user = clean({ ...data, id: profileId, active: true, authUid: uid, email, gen: 1, mustChangePassword: true, ...stamp(actor) });
    b.set(ref('members', uid), { profileId, role: user.role, active: true });
    for (const k of [user.username, user.empNo.toLowerCase()]) b.set(ref('logins', k), { email, profileId });
  }
  b.set(ref('users', user.id), user);
  await b.commit();
  await log(actor, data.id ? 'user.update' : 'user.create', `${user.name} (${user.empNo})`);
  return user;
});

// The browser SDK cannot change another person's password, so a reset
// issues a fresh sign-in account and retires the old one. The security
// rules only honour accounts listed in members/, so the old password stops
// working immediately.
export const resetPassword = guard(async (p, password, actor) => {
  const u = (await getDoc(ref('users', p.id))).data();
  const gen = (u.gen || 1) + 1;
  const email = emailFor(u.username, gen);
  const uid = await createAuthAccount(email, password);
  const b = writeBatch(fs);
  b.set(ref('members', uid), { profileId: u.id, role: u.role, active: u.active !== false });
  b.delete(ref('members', u.authUid));
  b.update(ref('users', u.id), { authUid: uid, email, gen, mustChangePassword: true, updatedAt: Date.now(), updatedBy: actor.name });
  for (const k of [u.username, String(u.empNo).toLowerCase()]) b.set(ref('logins', k), { email, profileId: u.id });
  await b.commit();
  await log(actor, 'user.reset', `${u.name} (${u.empNo})`);
});

export const setUserActive = guard(async (p, active, actor) => {
  const b = writeBatch(fs);
  b.update(ref('users', p.id), { active, updatedAt: Date.now(), updatedBy: actor.name });
  b.update(ref('members', p.authUid), { active });
  await b.commit();
  await log(actor, active ? 'user.enable' : 'user.disable', `${p.name} (${p.empNo})`);
});

// ---------- session ----------
async function loadMe() {
  const u = auth.currentUser; if (!u) return null;
  const m = await getDoc(ref('members', u.uid));
  if (!m.exists() || !m.data().active) return null;
  const p = await getDoc(ref('users', m.data().profileId));
  if (!p.exists() || p.data().active === false) return null;
  me = { authUid: u.uid, profileId: m.data().profileId, role: m.data().role };
  return { id: p.id, ...p.data() };
}

export const login = guard(async (login, password) => {
  const key = String(login).trim().toLowerCase();
  const l = await getDoc(ref('logins', key));
  if (!l.exists()) throw new Error('Username or password is incorrect.');
  await signInWithEmailAndPassword(auth, l.data().email, password);
  const user = await loadMe();
  if (!user) { await signOut(auth); throw new Error('This account is disabled. Ask your admin to enable it.'); }
  const session = { loginAt: Date.now(), uid: auth.currentUser.uid };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await updateDoc(ref('users', user.id), { lastLogin: session.loginAt }).catch(() => {});
  await log(user, 'auth.login');
  return { user, session };
});

export async function currentSession() {
  await ready;
  if (!auth.currentUser) return null;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { /* ignore */ }
  if (!s || s.uid !== auth.currentUser.uid || Date.now() - s.loginAt > SHIFT_MS) { await logout(); return null; }
  try {
    const user = await loadMe();
    if (!user) { await logout(); return null; }
    return { user, session: s };
  } catch { return null; }
}

export async function logout(user) {
  if (user) await log(user, 'auth.logout');
  localStorage.removeItem(SESSION_KEY);
  me = null;
  await signOut(auth).catch(() => {});
}

export const changePassword = guard(async (user, current, next) => {
  if (current !== null) await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(user.email, current));
  await updatePassword(auth.currentUser, next);
  await updateDoc(ref('users', user.id), { mustChangePassword: false, updatedAt: Date.now() });
  user.mustChangePassword = false;
  await log(user, 'auth.password', user.empNo);
});

// ---------- lists ----------
const listQuery = () => me?.role === 'admin' ? collection(fs, 'dispatches') : query(collection(fs, 'dispatches'), where('ownerUid', '==', auth.currentUser.uid));
const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);

export const dispatches = guard(async () => rows(await getDocs(listQuery())));
export const getDispatch = guard(async id => { const s = await getDoc(ref('dispatches', id)); return s.exists() ? { id: s.id, ...s.data() } : null; });

// Live updates for dashboards — fires with the full list whenever anything changes.
export function watch(cb) {
  if (!auth.currentUser) return () => {};
  let first = true;
  return onSnapshot(listQuery(), snap => { if (first) { first = false; return; } cb(rows(snap)); }, () => {});
}

export const createDispatch = guard(async (header, user, session) => {
  const now = Date.now();
  const id = newId('dispatches');
  const day = dayKey(now);
  const d = await runTransaction(fs, async tx => {
    const c = await tx.get(ref('counters', day));
    const seq = (c.exists() ? c.data().n : 0) + 1;
    const list = totals(clean({
      ...header, id, code: listCode(now, seq), status: 'open', createdAt: now,
      createdBy: user.id, ownerUid: auth.currentUser.uid, empName: user.name, empNo: user.empNo, loginAt: session.loginAt, boxes: []
    }));
    tx.set(ref('counters', day), { n: seq });
    tx.set(ref('dispatches', id), list);
    return list;
  });
  await log(user, 'list.create', d.code);
  return d;
});

// Adds one box inside a transaction so two phones cannot load the same box.
export const addBox = guard(async (d, rec, settings, user, via) => {
  const res = await runTransaction(fs, async tx => {
    const snap = await tx.get(ref('dispatches', d.id));
    const cur = snap.data();
    const prev = cur.boxes.find(b => sameBox(b, rec));
    if (prev) return { ok: false, reason: 'same', prev, cur };
    const ids = boxIds(rec);
    if (settings.blockCrossListDuplicates) {
      for (const k of ids) {
        const bk = await tx.get(ref('boxkeys', keyId(k)));
        if (bk.exists() && bk.data().dispatchId !== d.id) return { ok: false, reason: 'other', other: { code: bk.data().code, vehicleNo: bk.data().vehicleNo }, cur };
      }
    }
    const box = clean({ ...rec, seq: cur.boxes.length + 1, scannedAt: Date.now(), by: user.name, empNo: user.empNo, via });
    const next = totals({ ...cur, boxes: [...cur.boxes, box], updatedAt: Date.now() });
    tx.update(ref('dispatches', d.id), { boxes: next.boxes, totalBoxes: next.totalBoxes, labelWeight: next.labelWeight, totalWeight: next.totalWeight, updatedAt: next.updatedAt });
    if (settings.blockCrossListDuplicates) for (const k of ids) tx.set(ref('boxkeys', keyId(k)), { dispatchId: d.id, code: cur.code, vehicleNo: cur.vehicleNo, at: Date.now() });
    return { ok: true, box, cur: next };
  });
  Object.assign(d, res.cur, { id: d.id });
  delete res.cur;
  return res;
});

async function releaseKeys(b, box, dispatchId) {
  for (const k of boxIds(box)) {
    const s = await getDoc(ref('boxkeys', keyId(k))).catch(() => null);
    if (s?.exists() && s.data().dispatchId === dispatchId) b.delete(ref('boxkeys', keyId(k)));
  }
}

export const removeBox = guard(async (d, box, user) => {
  d.boxes = renumber(d.boxes.filter(b => b.key !== box.key));
  totals(d);
  const b = writeBatch(fs);
  b.update(ref('dispatches', d.id), { boxes: clean(d.boxes), totalBoxes: d.totalBoxes, labelWeight: d.labelWeight, totalWeight: d.totalWeight, updatedAt: Date.now() });
  await releaseKeys(b, box, d.id);
  await b.commit();
  await log(user, 'box.remove', `${box.boxNo || box.key} from ${d.code}`);
});

export const closeDispatch = guard(async (d, user, extra = {}) => {
  Object.assign(d, extra, { status: 'closed', closedAt: Date.now(), closedBy: user.name });
  totals(d);
  await updateDoc(ref('dispatches', d.id), clean({ status: 'closed', closedAt: d.closedAt, closedBy: d.closedBy, weightEntered: d.weightEntered ?? null, totalWeight: d.totalWeight, updatedAt: Date.now() }));
  await log(user, 'list.close', `${d.code} · ${d.boxes.length} boxes`);
});

export const reopenDispatch = guard(async (d, user) => {
  Object.assign(d, { status: 'open', closedAt: null, weightEntered: null });
  totals(d);
  await updateDoc(ref('dispatches', d.id), { status: 'open', closedAt: null, weightEntered: null, totalWeight: d.totalWeight, updatedAt: Date.now() });
  await log(user, 'list.reopen', d.code);
});

export const deleteDispatch = guard(async (d, user) => {
  const b = writeBatch(fs);
  for (const box of d.boxes) await releaseKeys(b, box, d.id);
  b.delete(ref('dispatches', d.id));
  await b.commit();
  await log(user, 'list.delete', d.code);
});

// ---------- data ----------
export const backup = guard(async () => ({
  app: 'yuken-pol', version: 1, mode: 'cloud', exportedAt: new Date().toISOString(),
  settings: await all('settings'), users: await all('users'), dispatches: await all('dispatches'), audit: await all('audit')
}));
export async function restore() { throw new Error('Restoring a backup is only available in on-device mode. Cloud data is already kept safe by Firebase.'); }

export const seedDemo = guard(async admin => {
  const existing = await all('users');
  const people = [];
  for (const p of DEMO_PEOPLE) people.push(existing.find(u => u.username === p.username) || await saveUser(p, admin, DEMO_PASSWORD));
  const lists = await demoLists(people, await getSettings());
  const counts = {};
  for (const l of lists) {
    const k = dayKey(l.createdAt); counts[k] = (counts[k] || 0) + 1;
    const { user, ...rest } = l;
    const id = newId('dispatches');
    const d = clean({ ...rest, id, code: listCode(l.createdAt, 900 + counts[k]), createdBy: user.id, ownerUid: user.authUid, empName: user.name, empNo: user.empNo });
    const b = writeBatch(fs);
    b.set(ref('dispatches', id), d);
    for (const box of d.boxes) for (const key of boxIds(box)) b.set(ref('boxkeys', keyId(key)), { dispatchId: id, code: d.code, vehicleNo: d.vehicleNo, at: Date.now() });
    await b.commit();
  }
  await log(admin, 'demo.seed');
});
