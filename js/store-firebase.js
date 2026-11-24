// Data store for the online version: Firebase Auth + Cloud Firestore.
// Same functions as store-local.js, so the screens work with either.
//
// Collections (see firestore.rules for who may read and write each one):
//   logins/{username}   public, names only: what the sign-in tiles show and
//                       which hidden sign-in email belongs to a username
//   members/{authUid}   links a Firebase sign-in to a username and role
//   people/{username}   the full profile (phone, address, Aadhaar …)
//   dispatches/{id}     loading lists with their boxes
//   photos/{id}         the driver photo of a list, kept apart to keep lists light
//   boxIndex/{sha1}     every box ever scanned → which list, for the duplicate check
//   counters/{day}      list number of the day (POL-YYYYMMDD-001)
//   audit/{id}          activity log
//   settings/{id}       app settings, last backup
//
// Accounts: only the admin creates them. A new person gets a hidden sign-in email
// (username.N@yuken-pol.app) and chooses their own password the first time
// they sign in. The admin "resets" a password by moving the person to a new
// hidden email (N+1); they then choose a new password.
import { auth, fdb, F } from './fb.js';
import { ADMIN } from './config.js';
import { fillMissing, DEFAULT_SETTINGS, SHIFT_MS, sameBox, boxIds, totals, renumber, clean, dayKey, listCode } from './common.js';

export const CLOUD = true;
export const authEmail = () => auth.currentUser?.email || '';

// Self-check for the error page: which reads the online database allows.
export async function diagnose() {
  const cu = auth.currentUser;
  const tests = [
    ['Settings', () => F.getDoc(D('settings', 'app'))],
    ['My sign-in record', () => F.getDoc(D('members', cu.uid))],
    ['Admin profile', () => F.getDoc(D('people', ADMIN_ID))],
    ['People list', () => F.getDocs(F.query(C('people'), F.limit(1)))],
    ['Loading lists', () => F.getDocs(F.query(C('dispatches'), F.orderBy('createdAt', 'desc'), F.limit(1)))],
    ['Activity log', () => F.getDocs(F.query(C('audit'), F.orderBy('at', 'desc'), F.limit(1)))]
  ];
  const out = [`Account: ${cu?.email || 'none'} · verified: ${cu?.emailVerified ? 'yes' : 'no'} · signed in with: ${cu?.providerData.map(p => p.providerId).join(', ') || '?'}`];
  for (const [name, fn] of tests) {
    try { const r = await fn(); out.push(`✓ ${name}${r.exists ? (r.exists() ? '' : ' (empty)') : ''}`); }
    catch (e) { out.push(`✗ ${name}: ${e.code || e.message}`); }
  }
  return out;
}
const SESSION_KEY = 'yk.cloud.session';
const MAIL = 'yuken-pol.app';
const ADMIN_ID = 'admin';

export const isAdmin = u => u?.role === 'manager' || u?.role === 'super';
export const isSuper = u => u?.role === 'super';

const D = (...p) => F.doc(fdb, ...p);
const C = name => F.collection(fdb, name);
const now = () => Date.now();
const low = v => String(v ?? '').trim().toLowerCase();
const timeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
const ADMIN_EMAILS = (ADMIN.emails || [ADMIN.email]).map(low);
const isSuperAuth = u => !!u && ADMIN_EMAILS.includes(low(u.email)) && u.emailVerified;
const hiddenEmail = (username, v) => `${username}.${v}@${MAIL}`;

// Writes that must not wait for the network (scanning works offline; the
// phone saves it and sends it when the connection is back).
function bg(p, what) {
  p.catch(e => {
    console.error(what, e);
    window.dispatchEvent(new CustomEvent('yk-sync-error', { detail: `${what}: ${friendly(e).message}` }));
  });
}

function friendly(e) {
  const c = e?.code || '';
  const m = {
    'auth/invalid-credential': 'Username or password is incorrect.',
    'auth/wrong-password': 'Username or password is incorrect.',
    'auth/user-not-found': 'Username or password is incorrect.',
    'auth/invalid-email': 'Username or password is incorrect.',
    'auth/too-many-requests': 'Too many wrong tries. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection. Connect and try again.',
    'auth/weak-password': 'Choose a longer password (at least 8 characters).',
    'auth/popup-closed-by-user': 'Google window was closed.',
    'auth/cancelled-popup-request': 'Google window was closed.',
    'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups and try again.',
    'auth/requires-recent-login': 'Please sign out, sign in again, and repeat this.',
    'auth/credential-already-in-use': 'That Google account is already linked to another person.',
    'permission-denied': 'You are not allowed to do that.',
    'unavailable': 'No internet connection. Connect and try again.'
  }[c];
  return m ? Object.assign(new Error(m), { code: c }) : e;
}

// ---------- current user ----------
let ME = null;   // the signed-in person's profile

async function ensureAdmin(cu) {
  let p = (await F.getDoc(D('people', ADMIN_ID))).data();
  if (!p) {
    p = { id: ADMIN_ID, role: 'super', name: ADMIN.name, username: ADMIN_ID, empNo: 'ADMIN', designation: 'Administrator', active: true, createdAt: now(), createdBy: 'system' };
    await F.setDoc(D('people', ADMIN_ID), p);
  } else if (p.name !== ADMIN.name || p.googleEmail) {
    // The admin account carries a generic name everywhere, also in old records.
    p = { ...p, name: ADMIN.name, googleEmail: null };
    await F.updateDoc(D('people', ADMIN_ID), { name: ADMIN.name, googleEmail: null });
    bg((async () => {
      const b = F.writeBatch(fdb); let n = 0;
      for (const a of docs(await F.getDocs(F.query(C('audit'), F.where('by', '==', ADMIN_ID))))) if (a.byName !== ADMIN.name) { b.update(D('audit', a.id), { byName: ADMIN.name }); n++; }
      for (const d of docs(await F.getDocs(F.query(C('dispatches'), F.where('createdBy', '==', ADMIN_ID))))) if (d.empName !== ADMIN.name) { b.update(D('dispatches', d.id), { empName: ADMIN.name }); n++; }
      if (n) await b.commit();
    })(), 'Renaming old admin records');
  }
  if (!(await F.getDoc(D('members', cu.uid))).exists()) await F.setDoc(D('members', cu.uid), { username: ADMIN_ID, role: 'super', active: true });
  return { ...p, id: ADMIN_ID, role: 'super', uid: cu.uid };
}

async function loadMe() {
  const cu = auth.currentUser;
  if (!cu) return null;
  if (isSuperAuth(cu)) return ensureAdmin(cu);
  const m = (await F.getDoc(D('members', cu.uid))).data();
  if (!m || !m.active) return null;
  const p = (await F.getDoc(D('people', m.username))).data();
  if (!p || !p.active) return null;
  return { ...p, id: m.username, role: m.role, uid: cu.uid };
}

async function startSession(via) {
  let user;
  try { user = await loadMe(); } catch (e) { await F.signOut(auth); throw friendly(e); }
  if (!user) {
    await F.signOut(auth);
    throw new Error('This account is not set up or is disabled. Ask the admin.');
  }
  ME = user;
  const session = { userId: user.id, loginAt: now(), via };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  bg(F.updateDoc(D('people', user.id), { lastLogin: session.loginAt }), 'Saving sign-in time');
  log(user, 'auth.login', via === 'google' ? 'with Google' : '');
  return { user, session };
}

export async function init() { await auth.authStateReady(); }

export async function currentSession() {
  await auth.authStateReady();
  if (!auth.currentUser) return null;
  let user = null;
  try { user = await loadMe(); } catch { user = null; }
  if (!user) { await F.signOut(auth); localStorage.removeItem(SESSION_KEY); return null; }
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { /* ignore */ }
  if (!s || s.userId !== user.id) { s = { userId: user.id, loginAt: now(), via: 'password' }; localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  // the admin and managers stay signed in until they press Sign out.
  // Employees are signed out after a shift, so the next person signs in fresh.
  if (!isAdmin(user) && now() - s.loginAt > SHIFT_MS) {
    await timeout(log(user, 'auth.logout', 'shift ended'), 2000);
    await F.signOut(auth); localStorage.removeItem(SESSION_KEY); return null;
  }
  ME = user;
  return { user, session: s };
}

export async function logout(user) {
  if (user) await timeout(log(user, 'auth.logout'), 2000);
  await F.signOut(auth);
  localStorage.removeItem(SESSION_KEY);
  ME = null;
}

// ---------- sign-in ----------
async function findLogin(login) {
  const l = low(login);
  if (!l) return null;
  const byName = await F.getDoc(D('logins', l));
  if (byName.exists()) return { id: byName.id, ...byName.data() };
  const q = await F.getDocs(F.query(C('logins'), F.where('empNoLower', '==', l), F.limit(1)));
  return q.empty ? null : { id: q.docs[0].id, ...q.docs[0].data() };
}

export async function login(username, password) {
  let l;
  try { l = await findLogin(username); } catch (e) { throw friendly(e); }
  if (!l || l.role === 'super') throw new Error('Username or password is incorrect.');
  if (!l.active) throw new Error('This account is disabled. Ask the admin to enable it.');
  if (l.needsPassword) throw Object.assign(new Error('Choose your password to finish setting up your account.'), { code: 'needsPassword', username: l.id, name: l.name });
  try { await F.signInWithEmailAndPassword(auth, l.authEmail, password); } catch (e) { throw friendly(e); }
  return startSession('password');
}

// The sign-in tiles: managers' names only.
export async function managersForLogin() {
  try {
    const snap = await F.getDocs(F.query(C('logins'), F.where('role', '==', 'manager'), F.where('active', '==', true)));
    return docs(snap).map(l => ({ id: l.id, name: l.name, username: l.id, designation: l.designation, needsPassword: !!l.needsPassword }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

// First sign-in of an account the admin created: the person picks a password.
export async function firstPassword(username, password) {
  const u = low(username);
  const snap = await F.getDoc(D('logins', u)).catch(e => { throw friendly(e); });
  const l = snap.data();
  if (!l || l.role === 'super' || !l.active) throw new Error('This account does not exist or is disabled. Ask the admin.');
  if (!l.needsPassword) throw new Error('This account already has a password. Sign in with it.');
  try {
    await F.createUserWithEmailAndPassword(auth, l.authEmail, password);
  } catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw friendly(e);
    // An earlier attempt got halfway. Same password finishes it; otherwise the admin resets.
    try { await F.signInWithEmailAndPassword(auth, l.authEmail, password); }
    catch { throw new Error('This account was already being set up. Ask the admin to reset your password.'); }
  }
  const uid = auth.currentUser.uid;
  try {
    if (!(await F.getDoc(D('members', uid))).exists()) await F.setDoc(D('members', uid), { username: u, role: l.role, active: true });
    await F.updateDoc(D('logins', u), { needsPassword: false, uid });
    await F.updateDoc(D('people', u), { needsPassword: false, uid, updatedAt: now() });
  } catch (e) { await F.signOut(auth); throw friendly(e); }
  const s = await startSession('password');
  log(s.user, 'user.update', 'set own password');
  return s;
}

// Admin: the admin's Gmail + the admin password he linked to it.
export async function adminLogin(password) {
  // Any admin Gmail that has an admin password linked to it.
  let ok = false, last;
  for (const email of ADMIN_EMAILS) {
    try { await F.signInWithEmailAndPassword(auth, email, password); ok = true; break; }
    catch (e) { last = e; if (!['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(e.code)) break; }
  }
  if (!ok) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(last?.code)) throw new Error('Admin password is incorrect. If you have not set one yet, use Sign in with Google.');
    throw friendly(last);
  }
  if (!isSuperAuth(auth.currentUser)) { await F.signOut(auth); throw new Error('Use Sign in with Google once to confirm the admin account.'); }
  return startSession('password');
}
export const adminHasPassword = () => !!auth.currentUser?.providerData.some(p => p.providerId === 'password');

export async function googleSignIn() {
  try { await F.signInWithPopup(auth, new F.GoogleAuthProvider()); } catch (e) { throw friendly(e); }
  const cu = auth.currentUser;
  if (isSuperAuth(cu)) return startSession('google');
  const m = await F.getDoc(D('members', cu.uid)).catch(() => null);
  if (!m?.exists()) {
    const email = cu.email;
    // A Gmail nobody linked: remove the empty sign-in it just created.
    try { await cu.delete(); } catch { await F.signOut(auth); }
    throw Object.assign(new Error(`${email} is not linked to an account.`), { code: 'unlinked', email });
  }
  return startSession('google');
}
export const loginGoogle = () => googleSignIn();

export async function linkGoogle(user, email) {
  const cu = auth.currentUser;
  if (email === null) {
    try { await F.unlink(cu, 'google.com'); } catch { /* not linked */ }
    await F.updateDoc(D('people', user.id), { googleEmail: null });
    user.googleEmail = null;
    log(user, 'user.update', 'removed Google link');
    return;
  }
  let res;
  try { res = await F.linkWithPopup(cu, new F.GoogleAuthProvider()); } catch (e) { throw friendly(e); }
  const g = res.user.providerData.find(p => p.providerId === 'google.com')?.email || '';
  await F.updateDoc(D('people', user.id), { googleEmail: low(g) });
  user.googleEmail = low(g);
  log(user, 'user.update', `linked Google ${g}`);
}

export async function changePassword(user, current, next) {
  const cu = auth.currentUser;
  try {
    await F.reauthenticateWithCredential(cu, F.EmailAuthProvider.credential(cu.email, current));
  } catch (e) { throw ['auth/invalid-credential', 'auth/wrong-password'].includes(e.code) ? new Error('Current password is incorrect.') : friendly(e); }
  await F.updatePassword(cu, next);
  await F.updateDoc(D('people', user.id), { mustChangePassword: false, updatedAt: now() });
  log(user, 'auth.password', user.empNo);
}

export async function changeAdminPassword(current, next, actor) {
  const cu = auth.currentUser;
  if (adminHasPassword()) return changePassword(actor, current, next);
  try { await F.linkWithCredential(cu, F.EmailAuthProvider.credential(cu.email, next)); }
  catch (e) {
    if (e.code !== 'auth/requires-recent-login') throw friendly(e);
    await F.signInWithPopup(auth, new F.GoogleAuthProvider());
    await F.linkWithCredential(auth.currentUser, F.EmailAuthProvider.credential(auth.currentUser.email, next));
  }
  log(actor, 'user.update', 'set the admin password');
}

// ---------- settings ----------
export async function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...((await timeout(F.getDoc(D('settings', 'app')), 6000, null))?.data() || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export async function saveSettings(patch, actor) {
  const s = clean({ ...(await getSettings()), ...patch, id: 'app' });
  await F.setDoc(D('settings', 'app'), s);
  log(actor, 'settings.update', Object.keys(patch).join(', '));
  return s;
}

// ---------- activity ----------
export function log(actor, action, detail = '') {
  if (!actor?.id || !auth.currentUser) return Promise.resolve();
  const entry = { at: now(), by: actor.id, byName: actor.name, action, detail: String(detail || '') };
  if (actor.id === ADMIN_ID) entry.account = auth.currentUser.email || '';   // which admin Gmail did it
  const p = F.addDoc(C('audit'), entry);
  p.catch(e => console.warn('activity not saved', e));
  return p.catch(() => {});
}
export async function auditTrail(n = 200) {
  return docs(await F.getDocs(F.query(C('audit'), F.orderBy('at', 'desc'), F.limit(n))));
}
export async function addNote(actor, text, at) {
  await F.addDoc(C('audit'), { at: at || now(), by: actor.id, byName: actor.name, action: 'note', detail: text, addedBy: actor.name });
}
export async function editAudit(id, patch, actor) {
  await F.updateDoc(D('audit', id), { ...patch, editedAt: now(), editedBy: actor.name });
}
export async function deleteAudit(id, actor) {
  const a = (await F.getDoc(D('audit', id))).data(); if (!a) return;
  await F.deleteDoc(D('audit', id));
  log(actor, 'audit.delete', `${a.byName}: ${a.action}${a.detail ? ' ' + a.detail : ''}`);
}

// ---------- people (the admin only changes these) ----------
export async function users() {
  return docs(await F.getDocs(C('people'))).sort((a, b) => a.name.localeCompare(b.name));
}
export const hasAdmin = async () => true;

function assertUnique(all, data) {
  for (const [f, label] of [['empNo', 'Employee no.'], ['username', 'Username'], ['phone', 'Mobile number'], ['aadhaar', 'Aadhaar']]) {
    const v = low(data[f]);
    if (v && all.some(u => u.id !== data.id && low(u[f]) === v)) throw new Error(`${label} ${data[f]} is already used by another account.`);
  }
}

export async function saveUser(data, actor) {
  if (data.role === 'super' && data.id !== ADMIN_ID) throw new Error('There is only one admin: the admin.');
  const all = await users();
  const existing = data.id ? all.find(u => u.id === data.id) : null;
  const { password, ...rest } = data;
  void password;
  const username = existing ? existing.username : low(data.username);
  if (existing && low(data.username) !== existing.username) throw new Error('The username cannot be changed. Disable this account and add a new one instead.');
  if (!existing && (await F.getDoc(D('logins', username))).exists()) throw new Error(`Username ${username} is already used.`);
  assertUnique(all, { ...rest, username, id: existing?.id });
  const t = now();
  const b = F.writeBatch(fdb);
  let user;
  if (existing) {
    user = clean({ ...existing, ...rest, id: existing.id, username, updatedAt: t, updatedBy: actor.name });
    b.set(D('people', user.id), user);
    if (user.id !== ADMIN_ID) {
      b.update(D('logins', username), { name: user.name, role: user.role, designation: user.designation || '', empNo: user.empNo, empNoLower: low(user.empNo) });
      if (existing.uid && existing.role !== user.role) b.update(D('members', existing.uid), { role: user.role });
    }
  } else {
    user = clean({
      ...rest, id: username, username, active: true, needsPassword: true, mustChangePassword: false, createdAt: t,
      createdBy: actor.id, createdByName: actor.name, createdByEmpNo: actor.empNo || '',
      createdFrom: /Mobile|Android|iPhone/.test(navigator.userAgent) ? 'Phone' : 'Computer'
    });
    b.set(D('people', username), user);
    b.set(D('logins', username), { name: user.name, role: user.role, designation: user.designation || '', empNo: user.empNo, empNoLower: low(user.empNo), authEmail: hiddenEmail(username, 1), v: 1, needsPassword: true, active: true });
  }
  await b.commit().catch(e => { throw friendly(e); });
  log(actor, existing ? 'user.update' : 'user.create', `${user.name} (${user.empNo})`);
  return user;
}

// Reset = the person chooses a new password the next time they sign in.
export async function resetPassword(p, _password, actor) {
  const l = (await F.getDoc(D('logins', p.username))).data();
  if (!l) throw new Error('Account not found.');
  const v = (l.v || 1) + 1;
  const b = F.writeBatch(fdb);
  b.update(D('logins', p.username), { authEmail: hiddenEmail(p.username, v), v, needsPassword: true, uid: F.deleteField() });
  b.update(D('people', p.username), { needsPassword: true, uid: F.deleteField(), updatedAt: now(), updatedBy: actor.name });
  if (l.uid) b.delete(D('members', l.uid));
  await b.commit().catch(e => { throw friendly(e); });
  log(actor, 'user.reset', `${p.name} (${p.empNo})`);
}

// Delete an account for good (the admin only). Their lists and activity stay.
export async function deleteUser(p, actor) {
  if (p.id === ADMIN_ID || p.role === 'super') throw new Error('The admin account cannot be deleted.');
  const b = F.writeBatch(fdb);
  b.delete(D('people', p.id));
  b.delete(D('logins', p.username));
  if (p.uid) b.delete(D('members', p.uid));
  await b.commit().catch(e => { throw friendly(e); });
  log(actor, 'user.delete', `${p.name} (${p.empNo})`);
}

export async function setUserActive(p, active, actor) {
  const b = F.writeBatch(fdb);
  b.update(D('people', p.id), { active, updatedAt: now(), updatedBy: actor.name });
  if (p.id !== ADMIN_ID) b.update(D('logins', p.username), { active });
  if (p.uid) b.update(D('members', p.uid), { active });
  await b.commit().catch(e => { throw friendly(e); });
  log(actor, active ? 'user.enable' : 'user.disable', `${p.name} (${p.empNo})`);
}

// ---------- lists ----------
const listQuery = user => isAdmin(user)
  ? F.query(C('dispatches'), F.orderBy('createdAt', 'desc'))
  : F.query(C('dispatches'), F.where('createdBy', '==', user.id));
const shape = d => totals({ ...d, boxes: d.boxes || [] });

export async function dispatches() {
  if (!ME) return [];
  return docs(await F.getDocs(listQuery(ME))).map(shape).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDispatch(id) {
  const snap = await F.getDoc(D('dispatches', id)).catch(() => null);
  if (!snap?.exists()) return null;
  const d = shape({ id: snap.id, ...snap.data() });
  if (d.hasPhoto) {
    const ph = await timeout(F.getDoc(D('photos', id)).catch(() => null), 8000, null);
    d.driverPhoto = ph?.data()?.data || null;
  }
  return d;
}

// Live updates: another phone adds a box or closes a list → screens refresh.
export function watch(fn) {
  if (!ME) return () => {};
  let first = true;
  return F.onSnapshot(listQuery(ME), () => { if (first) { first = false; return; } fn(); }, () => {});
}

async function nextCode(t) {
  const day = dayKey(t);
  const tx = F.runTransaction(fdb, async x => {
    const ref = D('counters', day);
    const n = ((await x.get(ref)).data()?.n || 0) + 1;
    x.set(ref, { n });
    return listCode(t, n);
  });
  // Offline: a code that is still unique, from the time.
  const fallback = `POL-${day}-${new Date(t).toTimeString().slice(0, 8).replace(/:/g, '')}`;
  return timeout(tx.catch(() => fallback), 5000, fallback);
}

export async function createDispatch(header, user, session) {
  const t = now();
  const ref = F.doc(C('dispatches'));
  const { driverPhoto, ...head } = header;
  const d = clean({
    id: ref.id, code: await nextCode(t), status: 'open', createdAt: t,
    createdBy: user.id, empName: user.name, empNo: user.empNo, loginAt: session.loginAt,
    ...head, hasPhoto: !!driverPhoto, boxes: []
  });
  bg(F.setDoc(ref, d), 'Saving the new list');
  if (driverPhoto) bg(F.setDoc(D('photos', ref.id), { data: driverPhoto, createdBy: user.id }), 'Saving the driver photo');
  log(user, 'list.create', d.code);
  return shape({ ...d, driverPhoto });
}

async function sha1(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function addBox(d, rec, settings, user, via) {
  const prev = d.boxes.find(b => sameBox(b, rec));
  if (prev) {
    const added = fillMissing(prev, rec);
    if (added.length) {
      totals(d);
      bg(F.updateDoc(D('dispatches', d.id), { boxes: clean(d.boxes), updatedAt: now() }), `Updating box ${prev.boxNo || ''}`);
      for (const k of await Promise.all(boxIds(rec).map(sha1))) bg(F.setDoc(D('boxIndex', k), { list: d.id, code: d.code, vehicleNo: d.vehicleNo || '', at: now() }), 'Saving the box index');
      return { ok: false, reason: 'filled', prev, added };
    }
    return { ok: false, reason: 'same', prev };
  }
  const keys = await Promise.all(boxIds(rec).map(sha1));
  if (settings.blockCrossListDuplicates) {
    for (const k of keys) {
      const s = await timeout(F.getDoc(D('boxIndex', k)).catch(() => null), 2500, null);
      const hit = s?.data();
      if (hit && hit.list !== d.id) return { ok: false, reason: 'other', other: { code: hit.code, vehicleNo: hit.vehicleNo } };
    }
  }
  const box = clean({ ...rec, seq: d.boxes.length + 1, scannedAt: now(), by: user.name, empNo: user.empNo, via });
  d.boxes.push(box); totals(d);
  bg(F.updateDoc(D('dispatches', d.id), { boxes: F.arrayUnion(box), updatedAt: now() }), `Saving box ${box.boxNo || ''}`);
  for (const k of keys) bg(F.setDoc(D('boxIndex', k), { list: d.id, code: d.code, vehicleNo: d.vehicleNo || '', at: now() }), 'Saving the box index');
  return { ok: true, box };
}

async function forgetBox(box) {
  for (const k of await Promise.all(boxIds(box).map(sha1))) bg(F.deleteDoc(D('boxIndex', k)), 'Updating the box index');
}

export async function removeBox(d, box, user) {
  d.boxes = renumber(d.boxes.filter(b => b.key !== box.key)); totals(d);
  bg(F.updateDoc(D('dispatches', d.id), { boxes: d.boxes, updatedAt: now() }), 'Removing the box');
  await forgetBox(box);
  log(user, 'box.remove', `${box.boxNo || box.key} from ${d.code}`);
}

export async function setBoxWeight(d, box, weight, user) {
  const b = d.boxes.find(x => x.key === box.key); if (!b) return;
  b.weight = weight; b.weightBy = user.name; totals(d);
  bg(F.updateDoc(D('dispatches', d.id), { boxes: clean(d.boxes), updatedAt: now() }), 'Saving the weight');
  log(user, 'box.weight', `${b.boxNo || b.key} on ${d.code}: ${weight ?? '—'} kg`);
}

export async function closeDispatch(d, user, extra = {}) {
  const fresh = await timeout(F.getDoc(D('dispatches', d.id)).catch(() => null), 4000, null);
  if (fresh?.exists()) d.boxes = fresh.data().boxes || d.boxes;
  delete d.weightEntered;
  totals(d);
  const patch = clean({ ...extra, status: 'closed', closedAt: now(), closedBy: user.name, weightEntered: extra.weightEntered ?? null });
  Object.assign(d, patch); totals(d);
  bg(F.updateDoc(D('dispatches', d.id), patch), 'Closing the list');
  log(user, 'list.close', `${d.code} · ${d.boxes.length} boxes`);
}

export async function reopenDispatch(d, user) {
  Object.assign(d, { status: 'open', closedAt: null, weightEntered: null }); totals(d);
  await F.updateDoc(D('dispatches', d.id), { status: 'open', closedAt: null, weightEntered: null }).catch(e => { throw friendly(e); });
  log(user, 'list.reopen', d.code);
}

export async function deleteDispatch(d, user) {
  await F.deleteDoc(D('dispatches', d.id)).catch(e => { throw friendly(e); });
  if (d.hasPhoto) bg(F.deleteDoc(D('photos', d.id)), 'Deleting the photo');
  for (const b of d.boxes) await forgetBox(b);
  log(user, 'list.delete', d.code);
}

// ---------- backups ----------
export async function backup() {
  const [people, lists, audit, settings, photos] = await Promise.all(['people', 'dispatches', 'audit', 'settings', 'photos'].map(async n => docs(await F.getDocs(C(n)))));
  const ph = Object.fromEntries(photos.map(p => [p.id, p.data]));
  return {
    app: 'yuken-pol', version: 2, cloud: true, exportedAt: now(),
    users: people, settings, audit,
    dispatches: lists.map(d => ({ ...d, driverPhoto: ph[d.id] || null }))
  };
}
export async function markBackup(where, user) {
  await F.setDoc(D('settings', 'lastBackup'), { id: 'lastBackup', at: now(), where, by: user?.name || '' });
  log(user, 'data.backup', where);
}
export const lastBackup = async () => (await F.getDoc(D('settings', 'lastBackup')).catch(() => null))?.data() || null;

// Restores lists, activity and settings. Accounts are not restored: each
// person keeps (or is re-added with) their own online sign-in.
export async function restore(data) {
  const lists = data.dispatches || [];
  let b = F.writeBatch(fdb), n = 0;
  const flush = async () => { if (n) await b.commit(); b = F.writeBatch(fdb); n = 0; };
  const put = async (ref, v) => { b.set(ref, clean(v)); if (++n >= 400) await flush(); };
  for (const d of lists) {
    const { driverPhoto, ...rest } = d;
    await put(D('dispatches', d.id), { ...rest, hasPhoto: !!driverPhoto });
    if (driverPhoto) await put(D('photos', d.id), { data: driverPhoto, createdBy: d.createdBy || ADMIN_ID });
  }
  for (const a of data.audit || []) await put(D('audit', a.id), a);
  for (const s of data.settings || []) if (s.id === 'app' || s.id === 'lastBackup') await put(D('settings', s.id), s);
  await flush();
  log(ME, 'data.import', `${lists.length} lists`);
}

// ---------- not used online ----------
const offline = () => { throw new Error('This is not available in the online version.'); };
export const seedDemo = offline;
export const masterReset = offline;
export const changeMasterPin = offline;
export const eraseAll = offline;
