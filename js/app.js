import { S } from './store.js';
import { parseScan, sampleLabel, FIELD_LABELS } from './parse.js';
import { $, $$, esc, fmt, initials, validate, normVehicle, prettyVehicle, compressImage, beep, unlockAudio } from './util.js';
import { icon, brand, toast, drawer, confirmBox, formDialog, field, setErrors, formData } from './ui.js';
import { startCamera, scanOnce, loadScript, takePhoto } from './camera.js';
import * as X from './export.js';
import { googleOn, googleProfile, driveBackup, driveList } from './google.js';

const app = $('#app');
const TOUCH = matchMedia('(pointer: coarse)').matches;
const isAdmin = u => u?.role === 'manager' || u?.role === 'super';   // sees everything
const isSuper = u => u?.role === 'super';                            // changes everything
const ROLE_NAME = { super: 'Admin', manager: 'Manager', employee: 'Employee' };

// ---------- light / dark ----------
const theme = () => document.documentElement.dataset.theme || 'dark';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('yk.theme', t); } catch { /* private mode */ }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#F3F6FA' : '#070F1D');
  $$('[data-theme-btn]').forEach(b => { b.innerHTML = themeIcon(); b.title = b.ariaLabel = t === 'light' ? 'Switch to dark mode' : 'Switch to light mode'; });
}
const themeIcon = () => icon(theme() === 'light' ? 'moon' : 'sun');
const themeBtn = (cls = 'btn ghost icon sm') => `<button class="${cls}" data-theme-btn type="button" title="${theme() === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}" aria-label="Switch theme">${themeIcon()}</button>`;
document.addEventListener('click', e => { if (e.target.closest('[data-theme-btn]')) setTheme(theme() === 'light' ? 'dark' : 'light'); });
document.addEventListener('pointerdown', unlockAudio, { capture: true });
let ME = null;        // { user, session }
let SETTINGS = null;
let cleanup = [];     // teardown callbacks for the current view (camera, listeners)

// ---------- router ----------
const routes = [];
const route = (re, fn, opts = {}) => routes.push({ re, fn, ...opts });

async function go() {
  try { await route_(); }
  catch (err) {
    console.error(err);
    app.innerHTML = `<div class="login"><section class="login-form" style="grid-column:1/-1">${brand(true)}<h1 style="margin-top:40px">Something went wrong</h1><p>${esc(err.message || err)}</p><button class="btn primary lg" onclick="location.reload()">Try again</button></section></div>`;
  }
}

async function route_() {
  for (const fn of cleanup.splice(0)) { try { await fn(); } catch { /* ignore */ } }
  const hash = location.hash.slice(1) || '/';
  await S.init();
  SETTINGS = await S.getSettings();

  if (!(await S.hasAdmin())) return render(viewSetup());
  ME = await S.currentSession();
  if (!ME) { if (hash !== '/login') history.replaceState(null, '', '#/login'); return render(viewLogin()); }
  if (ME.user.mustChangePassword) return render(viewChangePassword(true));

  for (const r of routes) {
    const m = hash.match(r.re);
    if (!m) continue;
    if (r.admin && !isAdmin(ME.user)) break;
    if (r.super && !isSuper(ME.user)) { toast('Only Chetan (admin) can open Settings', 'bad'); break; }
    try { return await r.fn(...m.slice(1)); }
    catch (err) {
      console.error(err);
      return render(frame('', `<main class="page"><div class="panel empty"><b>Could not open this page</b>${esc(err.message || err)}<br><a class="btn" href="#/">Go to start</a></div></main>`));
    }
  }
  location.replace(isAdmin(ME.user) ? '#/admin' : '#/home');
}

function render(html, after) {
  const paint = () => {
    app.innerHTML = typeof html === 'string' ? html : html.html;
    app.firstElementChild?.classList.add('view-enter');
    if (typeof html === 'object') html.bind?.();
    after?.();
    window.scrollTo(0, 0);
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = document.startViewTransition(paint);
    t.ready.catch(() => {}); t.finished.catch(() => {});
  }
  else paint();
}

window.addEventListener('hashchange', go);

// ---------- shells ----------
const NAV_ADMIN = [
  ['#/admin', 'grid', 'Dashboard'],
  ['#/new', 'scan', 'New list'],
  ['#/admin/lists', 'list', 'Lists'],
  ['#/admin/people', 'users', 'People'],
  ['#/admin/activity', 'activity', 'Activity'],
  ['#/admin/settings', 'cog', 'Settings']
];

const clockHTML = () => `<div class="clock"><b data-clock>${fmt.time(Date.now())}</b><span>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>`;
setInterval(() => $$('[data-clock]').forEach(el => { el.textContent = fmt.time(Date.now()); }), 15000);

function adminShell(active, content) {
  // Managers look, never change: no Settings, no New list.
  const items = NAV_ADMIN.filter(n => isSuper(ME.user) || !['#/admin/settings', '#/new'].includes(n[0]));
  const nav = items.map(([h, i, t]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${icon(i)}<span>${t}</span></a>`).join('');
  return `<div class="shell">
    <aside class="side">${brand()}<nav class="nav">${nav}</nav><div class="grow"></div>
      ${clockHTML()}
      <div class="me"><button class="me-btn" data-account title="My account"><div class="avatar">${initials(ME.user.name)}</div><div><b>${esc(ME.user.name)}</b><span>${ROLE_NAME[ME.user.role]} · ${esc(ME.user.empNo)}</span></div></button>
      ${themeBtn()}<button class="btn ghost icon sm" data-logout title="Sign out" aria-label="Sign out">${icon('logout')}</button></div></aside>
    <div><header class="mtop">${brand()}<span class="grow"></span>${themeBtn()}<button class="avatar sm" data-account aria-label="My account">${initials(ME.user.name)}</button></header>${content}</div>
    <nav class="tabbar">${items.filter(n => !['#/admin/activity', '#/admin/settings'].includes(n[0]) || (n[0] === '#/admin/activity' && !isSuper(ME.user))).map(([h, i, t]) => `<a href="${h}" class="${active === h ? 'on' : ''}">${icon(i)}<span>${t}</span></a>`).join('')}${isSuper(ME.user) ? `<a href="#/admin/settings" class="${active === '#/admin/settings' || active === '#/admin/activity' ? 'on' : ''}">${icon('cog')}<span>More</span></a>` : ''}</nav>
  </div>`;
}

function topbar(back) {
  const u = ME.user;
  return `<header class="topbar">
    ${back ? `<a class="btn ghost icon" href="${back}" aria-label="Back">${icon('back')}</a>` : ''}
    ${brand()}
    <div class="who"><div><b>${esc(u.name)}</b><span>Emp. ${esc(u.empNo)} · signed in ${fmt.time(ME.session.loginAt)}</span></div>
      ${themeBtn('btn ghost icon')}<button class="avatar" data-account aria-label="My account">${initials(u.name)}</button>
      <button class="btn ghost icon" data-logout title="Sign out" aria-label="Sign out">${icon('logout')}</button></div>
  </header>`;
}

// One shell for everything an employee sees; admins get the sidebar.
const frame = (active, content, back) => isAdmin(ME.user) ? adminShell(active, content) : `<div class="shell solo"><div>${topbar(back)}${content}</div></div>`;

document.addEventListener('click', async e => {
  if (e.target.closest('[data-account]') && ME) return accountDrawer();
  if (e.target.closest('[data-logout]')) {
    if (!(await confirmBox({ title: 'Sign out?', text: 'Open lists stay saved. The next person can sign in on this computer.', ok: 'Sign out' }))) return;
    await S.logout(ME?.user); ME = null; location.hash = '#/login'; go();
  }
});

// ---------- the sign-in stage (shared by setup, sign-in, new password) ----------
function stage(formHTML) {
  return `<div class="login">
    <section class="login-art" id="hero" aria-hidden="true">
      <div class="veil"></div>
      <div class="top">${brand(true)}${themeBtn('btn ghost icon theme-float')}</div>
      <div class="stamp"><div><strong>Every box, accounted for.</strong><p>Scan master-box labels straight into the vehicle's loading list.</p></div><div class="readout" id="readout"></div></div>
    </section>
    <section class="login-form">${formHTML}</section></div>`;
}
function mountStage() {
  import('./hero.js').then(m => { const host = $('#hero'); if (host) cleanup.push(m.mountHero(host, $('#readout'))); }).catch(() => {});
}

// ---------- first run ----------
function viewSetup() {
  return {
    html: stage(`
      <h1>Set up the admin account</h1>
      <p>This is Chetan's account. It controls everything: managers, employees, the activity log, settings and backups. You do this once.</p>
      ${googleOn() ? `<button type="button" class="btn lg google" id="g">${icon('google')} Fill in with Google</button><p class="or">or type the details</p>` : ''}
      <form id="f" novalidate>
        <div class="grid2">
          ${field({ name: 'name', label: 'Full name', attrs: 'autocomplete="name"' })}
          ${field({ name: 'empNo', label: 'Employee no.', cls: 'code' })}
        </div>
        ${field({ name: 'phone', label: 'Mobile number', type: 'tel', attrs: 'inputmode="numeric" maxlength="10"' })}
        ${field({ name: 'username', label: 'Username', attrs: 'autocapitalize="none" autocomplete="username"', hint: 'Used to sign in, e.g. chetan' })}
        ${field({ name: 'password', label: 'Password', type: 'password', attrs: 'autocomplete="new-password"', hint: 'At least 8 characters with a letter and a number. You use this every time after today.' })}
        <input type="hidden" name="googleEmail">
        <div class="linked" id="linked" hidden></div>
        <button class="btn primary lg" type="submit">Create admin account</button>
      </form>`),
    bind() {
      mountStage();
      $('#g')?.addEventListener('click', async () => {
        try {
          const g = await googleProfile();
          const f = $('#f');
          f.googleEmail.value = g.email;
          if (!f.name.value) f.name.value = g.name || '';
          if (!f.username.value) f.username.value = g.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '');
          $('#linked').hidden = false; $('#linked').innerHTML = `${icon('check')} Google account <b>${esc(g.email)}</b> will be linked. Next time you can also sign in with Google.`;
        } catch (err) { toast(err.message, 'bad', 5000); }
      });
      $('#f').onsubmit = async e => {
        e.preventDefault();
        const v = formData(e.target);
        v.username = v.username.trim().toLowerCase();
        const errs = { name: validate.name(v.name), empNo: validate.empNo(v.empNo), phone: validate.phone(v.phone), username: validate.username(v.username), password: validate.password(v.password) };
        if (!setErrors(e.target, errs)) return;
        const btn = e.target.querySelector('button[type=submit]'); btn.classList.add('busy');
        try {
          await S.setupAdmin({ name: v.name.trim(), empNo: v.empNo.trim().toUpperCase(), phone: v.phone.replace(/\D/g, '').slice(-10), username: v.username, designation: 'Administrator', googleEmail: v.googleEmail ? v.googleEmail.toLowerCase() : null }, v.password);
        } catch (err) { btn.classList.remove('busy'); return toast(err.message, 'bad', 5000); }
        toast('Admin account created. You stay signed in until you press Sign out.', 'ok', 5000);
        location.hash = '#/admin'; go();
      };
    }
  };
}

// ---------- sign in ----------
function viewLogin() {
  return {
    html: stage(`
      <div class="seg" role="tablist" id="who">
        <button type="button" role="tab" class="on" data-who="employee">Employee</button>
        <button type="button" role="tab" data-who="manager">Manager</button>
        <button type="button" role="tab" data-who="super">Admin</button>
      </div>
      <h1 id="lh">Sign in to start loading</h1>
      <p id="lp">Use the username or employee number Chetan gave you.</p>
      <div id="gbox" hidden>${googleOn() ? `<button type="button" class="btn lg google" id="g">${icon('google')} Sign in with Google</button><p class="or">or use your password</p>` : ''}</div>
      <form id="f" novalidate>
        ${field({ name: 'username', label: 'Username or employee no.', attrs: 'autocapitalize="none" autocomplete="username" autofocus' })}
        <div class="field" data-field="password"><label for="pw">Password</label>
          <div class="pw"><input class="input" id="pw" name="password" type="password" autocomplete="current-password">
          <button type="button" data-eye aria-label="Show password">${icon('eye')}</button></div><div class="msg"></div></div>
        <div id="err"></div>
        <button class="btn primary lg" type="submit">Sign in</button>
        <button type="button" class="linkbtn" id="forgot">Forgot password? Reset it with the master PIN</button>
      </form>
      <p class="login-foot">${esc(SETTINGS.company)} · ${esc(SETTINGS.docTitle)}${SETTINGS.plant ? ' · ' + esc(SETTINGS.plant) : ''}</p>`),
    bind() {
      mountStage();
      // Three doors: Employee, Manager (view only) and Admin (Chetan, full control).
      // An account only opens through its own door.
      const TEXT = {
        employee: ['Sign in to start loading', 'Use the username or employee number Chetan gave you.'],
        manager: ['Manager sign-in', 'See every list, the dashboard and the activity log. You stay signed in until you press Sign out.'],
        super: ['Admin sign-in', 'Full control of the app. For Chetan only.']
      };
      let door = 'employee';
      const who = w => {
        door = TEXT[w] ? w : 'employee';
        $$('#who button').forEach(b => b.classList.toggle('on', b.dataset.who === door));
        [$('#lh').textContent, $('#lp').textContent] = TEXT[door];
        $('#gbox').hidden = door === 'employee';
        try { localStorage.setItem('yk.who', door); } catch { /* ignore */ }
      };
      $$('#who button').forEach(b => b.onclick = () => who(b.dataset.who));
      who(localStorage.getItem('yk.who'));
      const DOOR_OF = { super: 'Admin', manager: 'Manager', employee: 'Employee' };
      const checkDoor = async me => {
        if (me.user.role === door) return me;
        await S.logout();
        throw new Error(`This is ${me.user.role === 'super' ? 'the admin' : 'a' + (me.user.role === 'employee' ? 'n employee' : ' manager')} account. Use the ${DOOR_OF[me.user.role]} tab.`);
      };
      $('#g')?.addEventListener('click', async e => {
        const btn = e.currentTarget; btn.classList.add('busy');
        try { const g = await googleProfile(); ME = await checkDoor(await S.loginGoogle(g.email)); location.hash = isAdmin(ME.user) ? '#/admin' : '#/home'; go(); }
        catch (err) { btn.classList.remove('busy'); $('#err').innerHTML = `<div class="form-err">${esc(err.message)}</div>`; }
      });
      $('[data-eye]').onclick = e => {
        const i = $('#pw'); const show = i.type === 'password';
        i.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye');
      };
      $('#forgot').onclick = () => formDialog({
        title: 'Reset a password',
        text: 'Chetan keeps the master PIN. It can reset anyone\'s password, including his own.',
        body: `${field({ name: 'login', label: 'Username or employee no.', value: $('#f_username').value, attrs: 'autocapitalize="none" autocomplete="off"' })}
          ${field({ name: 'pin', label: 'Master PIN', type: 'password', attrs: 'inputmode="numeric" autocomplete="off"' })}
          ${field({ name: 'next', label: 'New password', type: 'password', attrs: 'autocomplete="new-password"', hint: 'At least 8 characters with a letter and a number' })}`,
        ok: 'Reset password',
        async onSubmit(v, form) {
          if (!setErrors(form, { login: validate.required(v.login), pin: validate.required(v.pin), next: validate.password(v.next) })) return false;
          const u = await S.masterReset(v.login, v.pin, v.next);
          return u;
        }
      }).then(u => { if (u) { toast(`Password reset for ${u.name}. Sign in with the new one.`); $('#f_username').value = u.username; $('#pw').focus(); } });
      $('#f').onsubmit = async e => {
        e.preventDefault();
        const v = formData(e.target);
        if (!setErrors(e.target, { username: validate.required(v.username), password: validate.required(v.password) })) return;
        const btn = e.target.querySelector('button[type=submit]'); btn.classList.add('busy');
        try {
          ME = await checkDoor(await S.login(v.username, v.password));
          location.hash = isAdmin(ME.user) ? '#/admin' : '#/home';
          go();
        } catch (err) {
          btn.classList.remove('busy');
          $('#err').innerHTML = `<div class="form-err">${esc(err.message)}</div>`;
          $('#pw').select();
        }
      };
    }
  };
}

function viewChangePassword(forced) {
  return {
    html: stage(`
      <h1>Set your own password</h1>
      <p>${forced ? 'Your account was set up with a temporary password. Choose one only you know.' : ''}</p>
      <form id="f" novalidate>
        ${field({ name: 'next', label: 'New password', type: 'password', attrs: 'autocomplete="new-password"', hint: 'At least 8 characters with a letter and a number' })}
        ${field({ name: 'again', label: 'Type it again', type: 'password', attrs: 'autocomplete="new-password"' })}
        <button class="btn primary lg" type="submit">Save password</button>
        <button class="btn ghost" type="button" data-logout>Sign out</button>
      </form>`),
    bind() {
      mountStage();
      $('#f').onsubmit = async e => {
        e.preventDefault();
        const v = formData(e.target);
        if (!setErrors(e.target, { next: validate.password(v.next), again: v.again === v.next ? '' : 'Passwords do not match' })) return;
        await S.changePassword(ME.user, null, v.next);
        toast('Password saved');
        go();
      };
    }
  };
}

// ======================================================================
// Employee home
// ======================================================================
route(/^\/home$/, async () => {
  const mine = (await S.dispatches()).filter(d => d.createdBy === ME.user.id);
  const open = mine.filter(d => d.status === 'open');
  const recent = mine.filter(d => d.status === 'closed').slice(0, 9);
  const today = mine.filter(d => fmt.dayKey(d.createdAt) === fmt.dayKey(Date.now()));
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  render({
    html: frame('#/home', `<main class="page">
      <section class="hello">      <pre aria-hidden="true">   ______________    ______________
  /             /|  /             /|
 /_____________/ | /_____________/ |
 |  ▌▌▌▐▐▌▌▐   | | |  ▌▐▌▌▌▐▐▌   | |
 |  4270036177 | | |  4270036177 | |
 |_____________|/  |_____________|/
   ______________    ______________
  /             /|  /             /|
 /_____________/ | /_____________/ |
 |  ▌▐▐▌▌▌▐▌   | | |  ▌▌▐▌▐▐▌▌   | |
 |_____________|/  |_____________|/</pre><div><h1>${greet}, ${esc(ME.user.name.split(' ')[0])}</h1>
        <p>${today.length ? `Today: ${today.length} list${today.length > 1 ? 's' : ''}, ${fmt.num(today.reduce((s, d) => s + d.boxes.length, 0))} boxes loaded.` : 'No lists yet today. Start one when the vehicle is at the dock.'}</p></div>
        <a class="btn primary lg" href="#/new">${icon('plus')} New loading list</a></section>
      ${open.length ? `<h2 class="sec">Continue loading</h2><div class="lists">${open.map(listCard).join('')}</div>` : ''}
      <h2 class="sec">Recently closed</h2>
      ${recent.length ? `<div class="lists">${recent.map(listCard).join('')}</div>` : `<div class="panel empty"><b>Nothing closed yet</b>Closed lists appear here with their Excel, PDF and print options.</div>`}
    </main>`),
    bind() { $$('[data-open]').forEach(b => b.onclick = () => { location.hash = b.dataset.open; }); }
  });
});

window.addEventListener('offline', () => toast('Offline — scans will not save until the connection is back', 'bad', 5000));
window.addEventListener('online', () => toast('Back online'));

function listCard(d) {
  const href = d.status === 'open' ? `#/scan/${d.id}` : `#/list/${d.id}`;
  return `<button class="list-card" data-open="${href}">
    <div class="top"><span class="code mute" style="font-size:12.5px">${esc(d.code)}</span><span class="pill ${d.status}">${d.status === 'open' ? 'Loading' : 'Closed'}</span></div>
    <div><div class="veh">${esc(prettyVehicle(d.vehicleNo))}</div><div class="meta">${esc(d.transport)} · ${esc(d.location)}</div></div>
    <div class="nums"><div><b>${d.boxes.length}</b><span>boxes</span></div><div><b>${fmt.kg(d.totalWeight)}</b><span>weight</span></div><div><b>${fmt.time(d.createdAt)}</b><span>${fmt.date(d.createdAt)}</span></div></div>
  </button>`;
}

// ======================================================================
// New list — header details before scanning
// ======================================================================
route(/^\/new$/, async () => {
  if (ME.user.role === 'manager') { toast('Managers can view lists but not start them', 'bad'); return location.replace('#/admin'); }
  const s = SETTINGS;
  let photo = null;
  const transports = [['', 'Select transport'], ...s.transporters.map(t => [t, t]), ['__other', 'Other — type the name']];
  const locations = [['', 'Select location'], ...s.locations.map(t => [t, t]), ['__other', 'Other — type the location']];
  render({
    html: frame('#/new', `<main class="page">
      <div class="page-head"><div><h1>New loading list</h1><p>Fill the vehicle details first. Scanning opens once everything is in.</p></div></div>
      <form id="f" class="setup" novalidate>
        <div class="panel"><div class="panel-body">
          <div class="fgroup"><h3>Vehicle</h3><div class="grid2">
            ${field({ name: 'vehicleNo', label: 'Vehicle no.', cls: 'code', attrs: 'autocomplete="off" placeholder="KA19AB1234" autofocus' })}
            ${field({ name: 'transport', label: 'Transport name', options: transports })}
            <div class="field span" data-field="transportOther" hidden><label for="f_transportOther">Transport name</label><input class="input" id="f_transportOther" name="transportOther"><div class="msg"></div></div>
          </div></div>
          <div class="fgroup"><h3>Loading point</h3><div class="grid2">
            ${field({ name: 'location', label: 'Location', options: locations, span: true })}
            <div class="field span" data-field="locationOther" hidden><label for="f_locationOther">Location</label><input class="input" id="f_locationOther" name="locationOther"><div class="msg"></div></div>
          </div></div>
          <div class="fgroup" style="margin-bottom:0"><h3>Driver</h3><div class="grid2">
            ${field({ name: 'driverName', label: 'Driver name', attrs: 'autocomplete="off"' })}
            ${field({ name: 'driverPhone', label: 'Driver mobile', type: 'tel', opt: true, attrs: 'inputmode="numeric" maxlength="10"' })}
          </div></div>
        </div></div>
        <div style="display:grid;gap:16px">
          <div class="panel"><div class="panel-body">
            <div class="field" data-field="photo"><div class="lbl">Driver photo ${s.requirePhotoBeforeScan ? '' : '<small>Optional</small>'}</div>
              <button type="button" class="photo-slot" id="slot">
                <div class="ph">${icon('camera')}<b>Take driver photo</b><span>Opens the camera</span></div></button><div class="msg"></div></div>
            <ul class="checklist" id="cl">
              <li data-k="vehicleNo"><i>${icon('check')}</i>Vehicle no.</li>
              <li data-k="transport"><i>${icon('check')}</i>Transport</li>
              <li data-k="location"><i>${icon('check')}</i>Location</li>
              <li data-k="driverName"><i>${icon('check')}</i>Driver name</li>
              ${s.requirePhotoBeforeScan ? `<li data-k="photo"><i>${icon('check')}</i>Driver photo</li>` : ''}
            </ul>
          </div></div>
          <button class="btn primary lg" type="submit">${icon('scan')} Start scanning</button>
          <p class="mute" style="font-size:13px;margin:0">Employee ${esc(ME.user.name)} (${esc(ME.user.empNo)}) · logged in ${fmt.dt(ME.session.loginAt)}</p>
        </div>
      </form></main>`, '#/home'),
    bind() {
      const f = $('#f');
      const val = () => {
        const v = formData(f);
        return {
          vehicleNo: normVehicle(v.vehicleNo),
          transport: v.transport === '__other' ? (v.transportOther || '').trim() : v.transport,
          location: v.location === '__other' ? (v.locationOther || '').trim() : v.location,
          driverName: (v.driverName || '').trim(),
          driverPhone: (v.driverPhone || '').replace(/\D/g, '').slice(-10)
        };
      };
      const tick = () => {
        const v = { ...val(), photo };
        $$('#cl li').forEach(li => {
          const k = li.dataset.k;
          const ok = k === 'vehicleNo' ? !validate.vehicle(v.vehicleNo) : !!v[k];
          li.classList.toggle('done', ok);
        });
      };
      f.addEventListener('input', tick); f.addEventListener('change', tick);
      $('#f_vehicleNo').addEventListener('blur', e => { if (!validate.vehicle(e.target.value)) e.target.value = prettyVehicle(e.target.value); });
      const other = (sel, box) => $('#f_' + sel).addEventListener('change', e => {
        const show = e.target.value === '__other';
        $(`[data-field=${box}]`).hidden = !show;
        if (show) $('#f_' + box).focus();
      });
      other('transport', 'transportOther'); other('location', 'locationOther');
      $('#slot').onclick = async () => {
        const shot = await takePhoto('Driver photo');
        if (!shot) return;
        photo = shot;
        $('#slot').innerHTML = `<img src="${photo}" alt="Driver photo"><span class="btn sm retake">${icon('camera')} Retake</span>`;
        $('#slot').classList.remove('err');
        tick();
      };
      f.onsubmit = async e => {
        e.preventDefault();
        const v = val();
        const errs = {
          vehicleNo: validate.vehicle(v.vehicleNo),
          transport: f.transport.value === '__other' ? '' : validate.required(v.transport),
          transportOther: f.transport.value === '__other' ? validate.required(v.transport) : '',
          location: f.location.value === '__other' ? '' : validate.required(v.location),
          locationOther: f.location.value === '__other' ? validate.required(v.location) : '',
          driverName: validate.required(v.driverName),
          driverPhone: v.driverPhone ? validate.phone(v.driverPhone) : '',
          photo: s.requirePhotoBeforeScan && !photo ? 'Take the driver photo before scanning' : ''
        };
        $('#slot').classList.toggle('err', !!errs.photo);
        if (!setErrors(f, errs)) return;
        const d = await S.createDispatch({ ...v, driverPhoto: photo }, ME.user, ME.session);
        location.hash = `#/scan/${d.id}`;
      };
    }
  });
});

// ======================================================================
// Scan screen
// ======================================================================
route(/^\/scan\/(\w+)$/, async id => {
  const d = await S.getDispatch(id);
  if (!d) return location.replace('#/');
  if (d.status !== 'open') return location.replace(`#/list/${id}`);
  if (!isSuper(ME.user) && d.createdBy !== ME.user.id) { toast('Only the person loading this list (or Chetan) can scan into it', 'bad'); return location.replace(`#/list/${id}`); }
  let cam = null;

  const tile = (b, isNew) => `<button class="lbl-tile${isNew ? ' new' : ''}" data-key="${esc(b.key)}" data-seq="${b.seq}">
    <span class="bars"></span><span class="seq">#${b.seq}</span>
    <span class="no">${esc(b.boxNo || b.raw)}</span>
    <span class="sub"><span>${esc(b.item || (b.uid ? b.uid : 'Box'))}</span><span>${b.weight != null ? fmt.kg(b.weight) : fmt.time(b.scannedAt)}</span></span>
  </button>`;
  const tiles = () => d.boxes.length ? [...d.boxes].reverse().map(b => tile(b)).join('') : '';

  render({
    html: frame('#/new', `<div class="scan">
      <aside class="manifest">
        <div class="m-row"><div class="plate">${esc(prettyVehicle(d.vehicleNo))}</div>
        <div class="counter"><div><span>Boxes</span><b id="c-box">${d.boxes.length}</b></div><div><span>Weight</span><b id="c-wt">${fmtW(d.totalWeight)}</b></div></div></div>
        <dl>
          <dt>List</dt><dd class="code">${esc(d.code)}</dd>
          <dt>Transport</dt><dd>${esc(d.transport)}</dd>
          ${d.serialKey ? `<dt>Serial key</dt><dd class="code">${esc(d.serialKey)}</dd>` : ''}
          <dt>Location</dt><dd>${esc(d.location)}</dd>
          <dt>Employee</dt><dd>${esc(d.empName)} · ${esc(d.empNo)}</dd>
          <dt>Login time</dt><dd>${fmt.dt(d.loginAt)}</dd>
          <dt>Started</dt><dd>${fmt.time(d.createdAt)}</dd>
        </dl>
        <div class="driver">${d.driverPhoto ? `<img src="${d.driverPhoto}" alt="Driver">` : '<div class="ph"></div>'}<div><b>${esc(d.driverName || 'Driver')}</b><span>${esc(d.driverPhone || 'No mobile')}</span></div></div>
        <div class="grow"></div>
      </aside>
      <section class="dock">
        <div class="scanbar">
          <form class="scanfield" id="sf" autocomplete="off">
            <div class="wrap live">${icon('scan')}<input class="input" id="scan" placeholder="Scan master box label" aria-label="Scan master box label" ${TOUCH ? 'inputmode="none"' : 'autofocus'} spellcheck="false"></div>
            <button type="button" class="btn dark" id="camBtn">${icon('camera')}<span>Camera</span></button>
          </form>
          <div id="cam" hidden></div>
          <div class="status-line" id="st"><span class="dot"></span><span>${TOUCH ? 'Starting the camera…' : 'Ready. Scan with the barcode gun, or tap Camera.'}</span></div>
        </div>
        <div class="tray">
          <div class="tray-head"><span>Loaded on this vehicle</span><span id="last">${d.boxes.length ? 'Last scan ' + fmt.time(d.boxes.at(-1).scannedAt) : ''}</span></div>
          <div class="tray-grid" id="tray">${tiles()}</div>
          <div class="empty" id="empty" ${d.boxes.length ? 'hidden' : ''}><pre aria-hidden="true">   ____________
  /           /|
 /___________/ |
 | ▌▐▌▌▐▐▌▌  | |
 |  scan me  | /
 |___________|/</pre><b>No boxes yet</b>Each scanned label lands here. Scanning the same box twice is blocked.</div>
        </div>
        <div class="closebar">
          <span class="grow"></span>
          <a class="btn" href="${isAdmin(ME.user) ? '#/admin/lists' : '#/home'}">Save and exit</a>
          <button class="btn primary" id="close">${icon('check')} Close list</button>
        </div>
      </section></div>`),
    bind() {
      const input = $('#scan');
      const st = $('#st');
      const say = (msg, kind = '') => {
        st.className = 'status-line ' + kind; void st.offsetWidth; if (kind) st.classList.add('flash');
        st.innerHTML = `<span class="dot"></span><span>${msg}</span>`;
      };
      const bump = (el, v) => { el.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

      // Scans are queued, never dropped: a barcode gun can fire faster than
      // the cloud confirms each box.
      let queue = Promise.resolve();
      const add = (raw, via) => { queue = queue.then(() => addNow(raw, via)).catch(() => {}); return queue; };
      const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('No connection.')), ms))]);
      async function addNow(raw, via) {
        {
          const rec = parseScan(raw);
          if (!rec) return;
          let chk;
          try { chk = await withTimeout(S.addBox(d, rec, SETTINGS, ME.user, via), 12000); }
          catch (err) { beep('bad'); say(`Not saved — ${esc(err.message)} Scan the box again.`, 'bad'); return; }
          if (!chk.ok) {
            beep('dup');
            if (chk.reason === 'same') {
              const prev = chk.prev;
              say(`Already scanned — ${esc(rec.boxNo || rec.key)} is box #${prev.seq} on this list`, 'dup');
              const t = $(`.lbl-tile[data-key="${CSS.escape(prev.key)}"]`);
              if (t) { t.classList.remove('hit'); void t.offsetWidth; t.classList.add('hit'); t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
            } else {
              say(`Already loaded — ${esc(rec.boxNo || rec.key)} is on ${esc(chk.other.code)} (${esc(prettyVehicle(chk.other.vehicleNo))})`, 'bad');
            }
            return;
          }
          const box = chk.box;
          beep('ok');
          $('#empty').hidden = true;
          $('#tray').insertAdjacentHTML('afterbegin', tile(box, true));
          bump($('#c-box'), d.boxes.length);
          bump($('#c-wt'), fmtW(d.totalWeight));
          $('#last').textContent = 'Last scan ' + fmt.time(box.scannedAt);
          say(`Box #${box.seq} added — ${esc(box.boxNo || box.raw)}${box.item ? ' · ' + esc(box.item) : ''}`, 'ok');
          const w = $('.scanfield .wrap'); w.classList.remove('zap'); void w.offsetWidth; w.classList.add('zap');
        }
      }

      // A barcode gun types the code and presses Enter. QR labels with several
      // lines arrive as several Enters in quick succession, so wait a moment
      // before treating Enter as "done" and keep the lines together.
      let buf = '', timer = null, start = 0, idle = null;
      const commit = () => { timer = null; start = 0; const v = (buf + input.value).trim(); buf = ''; input.value = ''; if (v) add(v, 'scanner'); };
      $('#sf').onsubmit = e => e.preventDefault();
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'Tab') { if (timer) { clearTimeout(timer); timer = setTimeout(commit, 350); } return; }
        e.preventDefault();
        buf += input.value + '\n'; input.value = '';
        clearTimeout(timer); timer = setTimeout(commit, 350);
      });
      // Some scanners and phone scanner apps type the code without pressing
      // Enter, so codes piled up in the field. Text that arrives at scanner
      // speed (or is pasted) is added on its own after a short pause.
      input.addEventListener('input', e => {
        const now = performance.now(), len = input.value.length;
        clearTimeout(idle);
        if (!len) { start = 0; return; }
        if (!start) start = now;
        const fast = e.inputType === 'insertFromPaste' || (len >= 4 && (now - start) / len < 40);
        if (fast) idle = setTimeout(() => { if (!timer && input.value.trim()) commit(); }, 220);
      });
      cleanup.push(() => { clearTimeout(timer); clearTimeout(idle); });
      // Keep the barcode gun working even if focus wandered off the field.
      const refocus = e => {
        if (document.querySelector('.drawer, .dialog')) return;
        const t = e.target;
        if (t.closest && (t.closest('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey)) return;
        if (e.key.length === 1) input.focus();
      };
      document.addEventListener('keydown', refocus);
      cleanup.push(() => document.removeEventListener('keydown', refocus));


      const openCam = async () => {
        $('#cam').hidden = false;
        $('#cam').innerHTML = `<div class="camera"><div id="reader"></div><div class="frame"></div></div>`;
        $('#camBtn').innerHTML = `${icon('x')}<span>Stop</span>`;
        try {
          cam = await startCamera('reader', code => {
            const box = $('#cam .camera'); box?.classList.remove('hit'); void box?.offsetWidth; box?.classList.add('hit');
            add(code, 'camera');
          });
          say('Camera is on. Point it at each box label — it beeps when a box is captured.');
        }
        catch (err) { $('#cam').hidden = true; $('#camBtn').innerHTML = `${icon('camera')}<span>Camera</span>`; say('Camera unavailable — ' + esc(err?.message || 'permission denied') + '. Allow the camera in the browser settings, or use the barcode gun.', 'bad'); }
      };
      $('#camBtn').onclick = async () => {
        if (cam) { await cam.stop(); cam = null; $('#cam').hidden = true; $('#camBtn').innerHTML = `${icon('camera')}<span>Camera</span>`; say('Camera off. Use the barcode gun, or tap Camera.'); return; }
        openCam();
      };
      // Phones and tablets: start scanning with the camera straight away.
      if (TOUCH) openCam();
      cleanup.push(() => cam?.stop());

      $('#tray').onclick = e => {
        const t = e.target.closest('.lbl-tile'); if (!t) return;
        const b = d.boxes.find(x => x.key === t.dataset.key);
        const redraw = () => { $('#tray').innerHTML = tiles(); $('#empty').hidden = d.boxes.length > 0; bump($('#c-box'), d.boxes.length); bump($('#c-wt'), fmtW(d.totalWeight)); };
        boxDrawer(b, d, async () => {
          try { await S.removeBox(d, b, ME.user); } catch (err) { return toast(err.message, 'bad'); }
          redraw();
          say(`Removed ${esc(b.boxNo || b.key)} — numbers updated`, 'dup');
          toast('Box removed');
        }, redraw);
      };

      $('#close').onclick = async () => {
        if (!d.boxes.length) { say('Scan at least one box before closing the list.', 'bad'); beep('bad'); return; }
        const hasW = d.boxes.some(b => b.weight != null);
        const noW = d.boxes.filter(b => b.weight == null).length;
        const res = await confirmBox({
          title: 'Close this list?',
          text: `<b>${d.boxes.length} boxes</b> on <b>${esc(prettyVehicle(d.vehicleNo))}</b>.<br>${hasW ? `The labels add up to <b>${fmtW(d.labelWeight)} kg</b>.${noW ? ` ${noW} box${noW > 1 ? 'es have' : ' has'} no weight on the label.` : ''} Change the number only if the weighbridge says something else.` : 'The labels had no weight. Type the total weight in kg, or leave it empty.'}`,
          ok: 'Close list',
          input: { type: 'number', placeholder: 'Total weight (kg)', value: hasW ? d.labelWeight : '' }
        });
        if (res === false) return;
        const w = parseFloat(res);
        await cam?.stop(); cam = null;
        await S.closeDispatch(d, ME.user, { weightEntered: isNaN(w) || Math.abs(w - d.labelWeight) < 0.005 ? null : w });
        toast(`${d.code} closed`);
        sessionStorage.setItem('yk.preview', d.id);
        location.hash = `#/list/${d.id}`;
      };
    }
  });
});

const fmtW = w => (Number(w) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function boxDrawer(b, d, onRemove, onChange) {
  const keys = ['boxNo', 'packingSlip', 'boxIndex', 'item', 'qty', 'weight', 'datePacked', 'customer', 'shipTo', 'transporter', 'uid'];
  const rows = keys.filter(k => b[k] != null && b[k] !== '').map(k => `<dt>${FIELD_LABELS[k]}</dt><dd class="${['boxNo', 'uid', 'item'].includes(k) ? 'code' : ''}">${esc(k === 'weight' ? fmt.kg(b[k]) : b[k])}</dd>`).join('');
  const extra = Object.entries(b.extra || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  // Chetan can fix any list. Employees can fix their own list while it is open.
  const canEdit = isSuper(ME.user) || (d.status === 'open' && d.createdBy === ME.user.id);
  drawer({
    title: `Box #${b.seq}`,
    body: `<dl class="kv">${rows}${extra}<dt>Scanned</dt><dd>${fmt.dt(b.scannedAt)}</dd><dt>By</dt><dd>${esc(b.by || d.empName)}</dd><dt>Method</dt><dd>${esc(b.via || '—')}</dd>${b.weightBy ? `<dt>Weight typed by</dt><dd>${esc(b.weightBy)}</dd>` : ''}</dl>
      ${canEdit && onChange ? `<form class="wt-edit" id="wf"><label for="wt">${b.weight == null ? 'This label had no weight. Type it here' : 'Wrong weight? Correct it here'}</label>
        <div class="inline"><input class="input" id="wt" type="number" step="0.01" min="0" inputmode="decimal" placeholder="kg" value="${b.weight ?? ''}"><button class="btn">${icon('check')} Save weight</button></div></form>` : ''}
      <div class="raw">${esc(b.raw)}</div>`,
    foot: canEdit && onRemove ? `<button class="btn danger" data-rm>${icon('trash')} Remove from list</button>` : '',
    onMount(el, close) {
      el.querySelector('#wf')?.addEventListener('submit', async e => {
        e.preventDefault();
        const raw = el.querySelector('#wt').value.trim();
        const w = raw === '' ? null : Math.round(parseFloat(raw) * 1000) / 1000;
        if (raw !== '' && !(w >= 0)) return toast('Type the weight in kg, like 28.5', 'bad');
        await S.setBoxWeight(d, b, w, ME.user); close(); toast('Weight saved'); onChange();
      });
      el.querySelector('[data-rm]')?.addEventListener('click', async () => {
        if (!(await confirmBox({ title: 'Remove this box?', text: `${esc(b.boxNo || b.key)} will be taken off the list. Use this only if it was not loaded.`, ok: 'Remove box', danger: true }))) return;
        close(); onRemove();
      });
    }
  });
}

// ======================================================================
// List detail (employee + admin)
// ======================================================================
route(/^\/list\/(\w+)$/, async id => {
  const d = await S.getDispatch(id);
  if (!d) return location.replace('#/');
  const admin = isAdmin(ME.user);
  if (!admin && d.createdBy !== ME.user.id) return location.replace('#/home');
  const s = SETTINGS;
  const noW = d.boxes.filter(b => b.weight == null).length;
  const rows = d.boxes.map(b => `<tr class="link" data-k="${esc(b.key)}"><td class="num mute">${b.seq}</td><td class="code">${esc(b.boxNo || b.raw)}</td><td class="hide-sm">${esc(b.item || '—')}</td><td class="num hide-sm">${b.qty ?? '—'}</td><td class="num">${b.weight != null ? fmtW(b.weight) : '<span class="warn-dot" title="No weight">—</span>'}</td><td class="hide-sm code mute" style="font-weight:500">${esc(b.uid || '—')}</td><td class="num mute">${fmt.time(b.scannedAt)}</td></tr>`).join('');
  render({
    html: frame(admin ? '#/admin/lists' : '#/home', `<main class="page">
      <div class="page-head"><div>
        <h1 class="wide">${esc(prettyVehicle(d.vehicleNo))}</h1>
        <p><span class="code">${esc(d.code)}</span> · ${esc(d.transport)} <span class="pill ${d.status}">${d.status === 'open' ? 'Loading' : 'Closed ' + fmt.dt(d.closedAt)}</span></p></div>
        <div class="actions">
          ${d.status === 'open' && (isSuper(ME.user) || d.createdBy === ME.user.id) ? `<a class="btn primary" href="#/scan/${d.id}">${icon('scan')} Continue scanning</a>` : ''}
          ${isSuper(ME.user) && d.status === 'closed' ? `<button class="btn" data-reopen>${icon('undo')} Reopen</button>` : ''}
          ${isSuper(ME.user) ? `<button class="btn danger icon" data-del title="Delete list" aria-label="Delete list">${icon('trash')}</button>` : ''}
        </div></div>
      <div class="detail">
        <div class="panel">
          <div class="panel-head"><h2>${d.boxes.length} boxes</h2><span class="mute" style="font-size:13px">Tap a row for label details</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th class="num">#</th><th>Box no.</th><th class="hide-sm">Item</th><th class="num hide-sm">Qty</th><th class="num">Kg</th><th class="hide-sm">Unique ID</th><th class="num">Time</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7"><div class="empty"><b>No boxes on this list</b></div></td></tr>`}</tbody></table></div>
        </div>
        <aside>
          <div class="counter"><div><span>Total boxes</span><b>${d.boxes.length}</b></div><div><span>Total weight (kg)</span><b>${fmtW(d.totalWeight)}</b></div></div>
          ${d.weightEntered != null ? `<div class="note-line">${icon('alert')} Weighbridge weight typed at closing. The labels add up to <b>${fmtW(d.labelWeight)} kg</b>.</div>` : ''}
          ${noW ? `<div class="note-line">${icon('alert')} ${noW} box${noW > 1 ? 'es have' : ' has'} no weight on the label${isSuper(ME.user) || d.status === 'open' ? ' — tap the box to type it' : ''}.</div>` : ''}
          <div class="panel"><div class="panel-body">
            <div class="export-grid">
              <button class="btn primary span" data-x="preview">${icon('eye')} Preview POL sheet</button>
              <button class="btn" data-x="print">${icon('print')} Print</button>
              <button class="btn" data-x="pdf">${icon('pdf')} PDF</button>
              <button class="btn" data-x="xlsx">${icon('xls')} Excel</button>
              <button class="btn" data-x="share">${icon('share')} Share</button>
            </div></div></div>
          <div class="panel"><div class="panel-body">
            <dl class="kv" style="grid-template-columns:110px 1fr">
              <dt>Employee</dt><dd>${esc(d.empName)} (${esc(d.empNo)})</dd>
              <dt>Login time</dt><dd>${fmt.dt(d.loginAt)}</dd>
              ${d.serialKey ? `<dt>Serial key</dt><dd class="code">${esc(d.serialKey)}</dd>` : ''}
              <dt>Location</dt><dd>${esc(d.location)}</dd>
              <dt>Driver</dt><dd>${esc(d.driverName || '—')}${d.driverPhone ? '<br><span class="mute">' + esc(d.driverPhone) + '</span>' : ''}</dd>
              <dt>Started</dt><dd>${fmt.dt(d.createdAt)}</dd>
            </dl>
            ${d.driverPhoto ? `<img src="${d.driverPhoto}" alt="Driver photo" style="margin-top:14px;border-radius:10px;width:100%;aspect-ratio:4/3;object-fit:cover">` : ''}
          </div></div>
        </aside>
      </div></main>`, '#/home'),
    bind() {
      $$('tr[data-k]').forEach(tr => tr.onclick = () => boxDrawer(d.boxes.find(b => b.key === tr.dataset.k), d, isSuper(ME.user) ? async () => { await S.removeBox(d, d.boxes.find(b => b.key === tr.dataset.k), ME.user); toast('Box removed'); go(); } : null, () => go()));
      $$('[data-x]').forEach(b => b.onclick = () => {
        if (b.dataset.x === 'preview') return openPreview(d, s);
        runExport(b.dataset.x, d, s, b);
      });
      if (sessionStorage.getItem('yk.preview') === d.id) { sessionStorage.removeItem('yk.preview'); setTimeout(() => openPreview(d, s), 350); }
      $('[data-reopen]')?.addEventListener('click', async () => {
        if (!(await confirmBox({ title: 'Reopen this list?', text: 'Scanning will be allowed again. The reopen is recorded in Activity.', ok: 'Reopen' }))) return;
        await S.reopenDispatch(d, ME.user); toast('List reopened'); location.hash = `#/scan/${d.id}`;
      });
      $('[data-del]')?.addEventListener('click', async () => {
        const v = await confirmBox({ title: 'Delete this list?', text: `This removes <b>${esc(d.code)}</b> and its ${d.boxes.length} boxes for good. Type <b>DELETE</b> to confirm.`, ok: 'Delete list', danger: true, input: { placeholder: 'DELETE' } });
        if (v !== 'DELETE') { if (v !== false) toast('Type DELETE to confirm', 'bad'); return; }
        await S.deleteDispatch(d, ME.user); toast('List deleted'); location.hash = '#/admin/lists';
      });
    }
  });
});

async function runExport(kind, d, s, b) {
  b?.classList.add('busy');
  try {
    if (kind === 'xlsx') { await loadScript('vendor/xlsx.full.min.js'); X.downloadExcel(d, s); toast('Excel downloaded'); }
    if (kind === 'pdf') { await loadPdf(); await X.downloadPDF(d, s); toast('PDF downloaded'); }
    if (kind === 'print') X.printSheet(d, s);
    if (kind === 'share') { await loadPdf(); const r = await X.share(d, s); if (r === 'fallback') toast('PDF downloaded — attach it in WhatsApp'); }
    await S.log(ME.user, 'list.' + kind, d.code);
  } catch (err) { if (err?.name !== 'AbortError') toast(err.message || 'Could not export', 'bad'); }
  b?.classList.remove('busy');
}

// Full-screen preview of the A4 POL sheet, with the output actions beside it.
function openPreview(d, s) {
  const el = document.createElement('div');
  el.className = 'preview'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="stage"><div class="sheet">${X.sheetHTML(d, s)}</div></div>
    <aside class="tools"><h2>POL sheet</h2><p>${esc(d.code)} · ${esc(prettyVehicle(d.vehicleNo))} · ${d.boxes.length} boxes</p>
      <button class="btn primary" data-p="print">${icon('print')} Print</button>
      <button class="btn" data-p="pdf">${icon('pdf')} Download PDF</button>
      <button class="btn" data-p="xlsx">${icon('xls')} Download Excel</button>
      <button class="btn" data-p="share">${icon('share')} Share</button>
      <span class="grow"></span>
      <button class="btn ghost" data-p="close">${icon('x')} Close preview</button></aside>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => b.dataset.p === 'close' ? close() : runExport(b.dataset.p, d, s, b));
  el.querySelector('[data-p=print]').focus();
}

const loadPdf = async () => { await loadScript('vendor/jspdf.umd.min.js'); await loadScript('vendor/jspdf.plugin.autotable.min.js'); };

// ======================================================================
// Admin: overview
// ======================================================================
route(/^\/admin$/, async () => {
  const all = await S.dispatches();
  const people = await S.users();
  const now = Date.now(), today = fmt.dayKey(now);
  const tl = all.filter(d => fmt.dayKey(d.createdAt) === today);
  const yl = all.filter(d => fmt.dayKey(d.createdAt) === fmt.dayKey(now - 86400000));
  const sumB = l => l.reduce((s, d) => s + d.boxes.length, 0);
  const sumW = l => l.reduce((s, d) => s + (Number(d.totalWeight) || 0), 0);
  const boxesToday = sumB(tl), wtToday = sumW(tl);
  const diff = boxesToday - sumB(yl);
  const open = all.filter(d => d.status === 'open');
  const days = Array.from({ length: 7 }, (_, i) => { const t = now - (6 - i) * 86400000; const k = fmt.dayKey(t); const l = all.filter(d => fmt.dayKey(d.createdAt) === k); return { t, k, n: sumB(l), w: sumW(l) }; });
  const max = Math.max(1, ...days.map(d => d.n));
  const audit = await S.auditTrail(7);
  const onShift = people.filter(p => p.lastLogin && fmt.dayKey(p.lastLogin) === today);
  const byEmp = Object.values(tl.reduce((m, d) => { const r = (m[d.createdBy] ||= { name: d.empName, empNo: d.empNo, lists: 0, boxes: 0, w: 0 }); r.lists++; r.boxes += d.boxes.length; r.w += Number(d.totalWeight) || 0; return m; }, {})).sort((a, b) => b.boxes - a.boxes);
  const closed = all.filter(d => d.status === 'closed').slice(0, 6);
  const bk = isSuper(ME.user) ? await S.lastBackup() : null;
  const bkOld = isSuper(ME.user) && (!bk || now - bk.at > 7 * 86400000);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  render({
    html: adminShell('#/admin', `<main class="page">
      <div class="page-head"><div><h1>${greet}, ${esc(ME.user.name.split(' ')[0])}</h1><p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · ${esc(SETTINGS.plant || SETTINGS.company)}</p></div>
        ${isSuper(ME.user) ? `<div class="actions"><a class="btn" href="#/admin/people?add">${icon('plus')} Add person</a><a class="btn primary" href="#/new">${icon('scan')} New list</a></div>` : '<div class="actions"><span class="pill open">View only</span></div>'}</div>
      ${bkOld ? `<div class="banner">${icon('cloud')}<div><b>${bk ? 'Last backup was ' + fmt.ago(bk.at) : 'No backup yet'}</b><span>Everything is stored on this device. Keep a copy in case the computer breaks.</span></div><button class="btn primary" id="bkNow">${icon('cloud')} Back up now</button></div>` : ''}
      <div class="kpis">
        <div class="kpi hero">${spark(days.map(x => x.n))}<span>Boxes loaded today</span><b>${fmt.num(boxesToday)}</b><small>${tl.length} list${tl.length === 1 ? '' : 's'} · ${diff === 0 ? 'same as yesterday' : `${diff > 0 ? '+' : ''}${diff} vs yesterday`}</small></div>
        <div class="kpi"><span>Weight today</span><b>${fmtW(wtToday)}</b><small>kg loaded</small></div>
        <a class="kpi link" href="#/admin/lists?open"><span>Vehicles loading now</span><b>${open.length}</b><small>${open.length ? open.map(d => prettyVehicle(d.vehicleNo)).slice(0, 2).join(', ') : 'none at the dock'}</small></a>
        <a class="kpi link" href="#/admin/activity"><span>Signed in today</span><b>${onShift.length}</b><small>of ${people.filter(p => p.active).length} people</small></a>
      </div>
      ${open.length ? `<h2 class="sec">Loading now</h2><div class="lists">${open.map(listCard).join('')}</div>` : ''}
      <div class="split">
        <div class="panel"><div class="panel-head"><h2>Boxes per day</h2><span class="mute" style="font-size:13px">Last 7 days</span></div>
          <div class="panel-body"><div class="bars">${days.map((d, i) => `<div class="bar ${i === 6 ? 'today' : ''}" title="${fmtW(d.w)} kg"><b>${d.n || ''}</b><i style="height:${(d.n / max) * 100}%;animation-delay:${i * 40}ms"></i><span>${i === 6 ? 'Today' : new Date(d.t).toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>`).join('')}</div></div></div>
        <div class="panel"><div class="panel-head"><h2>Today by person</h2></div>
          ${byEmp.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Person</th><th class="num">Lists</th><th class="num">Boxes</th><th class="num">Kg</th></tr></thead><tbody>${byEmp.map(r => `<tr><td><div class="person"><div class="avatar" style="width:30px;height:30px;font-size:11px">${initials(r.name)}</div><div><b>${esc(r.name)}</b><span>${esc(r.empNo)}</span></div></div></td><td class="num">${r.lists}</td><td class="num"><b>${fmt.num(r.boxes)}</b></td><td class="num">${fmtW(r.w)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No loading yet today</b>People appear here as soon as they start a list.</div>'}</div>
      </div>
      <div class="split">
        <div class="panel"><div class="panel-head"><h2>Recently closed</h2><a href="#/admin/lists" style="font-size:13px">All lists</a></div>
          ${closed.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Vehicle</th><th class="hide-sm">Closed</th><th class="num">Boxes</th><th class="num">Kg</th></tr></thead><tbody>${closed.map(d => `<tr class="link" data-id="${d.id}"><td><b class="wide">${esc(prettyVehicle(d.vehicleNo))}</b><div class="mute" style="font-size:12.5px">${esc(d.transport)}</div></td><td class="hide-sm mute">${fmt.ago(d.closedAt)}</td><td class="num"><b>${d.boxes.length}</b></td><td class="num">${fmtW(d.totalWeight)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Nothing closed yet</b></div>'}</div>
        <div class="panel"><div class="panel-head"><h2>Latest activity</h2><a href="#/admin/activity" style="font-size:13px">See all</a></div>
          <ul class="feed">${audit.map(a => `<li><div class="avatar" style="width:30px;height:30px;font-size:11px">${initials(a.byName)}</div><div><b>${esc(a.byName)}</b><p>${esc(describe(a))}</p></div><time>${fmt.ago(a.at)}</time></li>`).join('') || '<li><div class="mute">Nothing yet</div></li>'}</ul></div>
      </div>
    </main>`),
    bind() {
      $$('[data-open]').forEach(b => b.onclick = () => { location.hash = b.dataset.open.replace('#/scan/', '#/list/'); });
      $$('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = `#/list/${tr.dataset.id}`; });
      $('#bkNow')?.addEventListener('click', e => backupNow(e.currentTarget));
      live(() => { if (location.hash === '#/admin' && !document.querySelector('.drawer,.dialog')) go(); });
    }
  });
}, { admin: true });

// Back up: Google Drive when Google is set up, otherwise a file download.
async function backupNow(btn) {
  btn?.classList.add('busy');
  try {
    const data = await S.backup();
    if (googleOn()) {
      const name = await driveBackup(data, ME.user.googleEmail);
      await S.markBackup('Google Drive', ME.user);
      toast(`Saved to Google Drive → Yuken POL backups → ${name}`, 'ok', 5000);
    } else {
      const { download } = await import('./util.js');
      download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `yuken-backup-${fmt.isoDate(Date.now())}.json`);
      await S.markBackup('file download', ME.user);
      toast('Backup file downloaded. Keep it in Google Drive or on a pen drive.', 'ok', 5000);
    }
    if (location.hash === '#/admin' || location.hash === '#/admin/settings') go();
  } catch (err) { toast(err.message, 'bad', 5000); }
  btn?.classList.remove('busy');
}

// Everyone: my account — password, theme, Google link, sign out.
function accountDrawer() {
  const u = ME.user;
  drawer({
    title: 'My account',
    body: `<div class="person" style="margin-bottom:18px"><div class="avatar" style="width:48px;height:48px;font-size:16px">${initials(u.name)}</div><div><b style="font-size:17px">${esc(u.name)}</b><span>${ROLE_NAME[u.role]} · ${esc(u.empNo)}</span></div></div>
      <dl class="kv" style="margin-bottom:20px"><dt>Signed in</dt><dd>${fmt.dt(ME.session.loginAt)}${ME.session.via === 'google' ? ' with Google' : ''}</dd>
        <dt>Stays signed in</dt><dd>${isAdmin(u) ? 'Until you press Sign out' : 'Until the end of the shift'}</dd></dl>
      <div class="fgroup"><h3>Look</h3><button class="btn" data-theme-btn-row type="button">${icon(theme() === 'light' ? 'moon' : 'sun')} ${theme() === 'light' ? 'Use dark mode' : 'Use light mode'}</button></div>
      ${googleOn() && isAdmin(u) ? `<div class="fgroup"><h3>Google sign-in</h3>${u.googleEmail ? `<p class="mute" style="margin:0 0 10px">Linked to <b>${esc(u.googleEmail)}</b></p><button class="btn" id="unlink">Remove Google link</button>` : `<p class="mute" style="margin:0 0 10px">Link your Gmail to sign in with one tap.</p><button class="btn google" id="link">${icon('google')} Link my Google account</button>`}</div>` : ''}
      <div class="fgroup"><h3>Change password</h3><form id="cp" style="display:grid;gap:14px" novalidate>
        ${field({ name: 'cur', label: 'Current password', type: 'password' })}${field({ name: 'next', label: 'New password', type: 'password', hint: 'At least 8 characters with a letter and a number' })}${field({ name: 'again', label: 'Type it again', type: 'password' })}
        <div><button class="btn primary">Save password</button></div></form></div>`,
    foot: `<button class="btn danger" data-logout>${icon('logout')} Sign out</button>`,
    onMount(el, close) {
      el.querySelector('[data-theme-btn-row]').onclick = () => { setTheme(theme() === 'light' ? 'dark' : 'light'); close(); };
      el.querySelector('#link')?.addEventListener('click', async () => {
        try { const g = await googleProfile(); await S.linkGoogle(u, g.email); close(); toast(`Linked ${g.email}. Use "Sign in with Google" next time.`); } catch (err) { toast(err.message, 'bad', 5000); }
      });
      el.querySelector('#unlink')?.addEventListener('click', async () => { await S.linkGoogle(u, null); close(); toast('Google link removed'); });
      el.querySelector('[data-logout]').addEventListener('click', () => close());
      el.querySelector('#cp').onsubmit = async e => {
        e.preventDefault();
        const f = e.target; const v = formData(f);
        if (!setErrors(f, { cur: validate.required(v.cur), next: validate.password(v.next), again: v.again === v.next ? '' : 'Passwords do not match' })) return;
        try { await S.changePassword(u, v.cur, v.next); close(); toast('Password changed'); } catch (err) { setErrors(f, { cur: err.message }); }
      };
    }
  });
}

function spark(vals) {
  const max = Math.max(1, ...vals), w = 84, h = 30;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${pts}"/><circle cx="${w}" cy="${h - 3 - (vals.at(-1) / max) * (h - 6)}" r="3" fill="currentColor"/></svg>`;
}

// Re-run when lists change (no-op on a single computer).
function live(fn) {
  let t;
  const off = S.watch(() => { clearTimeout(t); t = setTimeout(fn, 400); });
  cleanup.push(() => { clearTimeout(t); off(); });
}

const ACTIONS = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'auth.password': 'Changed password',
  'user.create': 'Added employee', 'user.update': 'Updated employee', 'user.enable': 'Enabled', 'user.disable': 'Disabled', 'user.delete': 'Deleted employee', 'user.reset': 'Reset password for',
  'list.create': 'Started list', 'list.close': 'Closed list', 'list.reopen': 'Reopened list', 'list.delete': 'Deleted list',
  'list.xlsx': 'Exported Excel', 'list.pdf': 'Exported PDF', 'list.print': 'Printed', 'list.share': 'Shared',
  'box.remove': 'Removed box', 'box.weight': 'Set weight of', 'settings.update': 'Changed settings', 'demo.seed': 'Loaded demo data', 'data.import': 'Restored backup', 'data.backup': 'Backed up to', 'report.xlsx': 'Exported report',
  'note': '', 'audit.delete': 'Deleted activity entry —'
};
const describe = a => [ACTIONS[a.action] ?? a.action, a.detail].filter(Boolean).join(' ');

// ======================================================================
// Admin: lists
// ======================================================================
route(/^\/admin\/lists(?:\?(\w+))?$/, async (qs) => {
  let all = await S.dispatches();
  const people = await S.users();
  render({
    html: adminShell('#/admin/lists', `<main class="page">
      <div class="page-head"><div><h1>Loading lists</h1><p>Every list from every person. Search finds box numbers too.</p></div>
        <div class="actions"><button class="btn" id="rep">${icon('xls')} Export shown</button></div></div>
      <div class="panel">
        <div class="toolbar">
          <div class="search">${icon('search')}<input class="input" id="q" placeholder="Vehicle, list or box no."></div>
          <select class="input" id="emp"><option value="">All employees</option>${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <select class="input" id="stt"><option value="">Any status</option><option value="open">Loading</option><option value="closed">Closed</option></select>
          <input class="input" type="date" id="from" aria-label="From date"><input class="input" type="date" id="to" aria-label="To date">
        </div>
        <div class="table-wrap"><table class="t"><thead><tr><th>List</th><th>Vehicle</th><th class="hide-sm">Transport</th><th class="hide-sm">Employee</th><th class="num">Boxes</th><th class="num hide-sm">Kg</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
      </div></main>`),
    bind() {
      let shown = all;
      const draw = () => {
        const q = $('#q').value.trim().toUpperCase().replace(/\s/g, '');
        const emp = $('#emp').value, st = $('#stt').value, from = $('#from').value, to = $('#to').value;
        shown = all.filter(d =>
          (!emp || d.createdBy === emp) && (!st || d.status === st) &&
          (!from || fmt.isoDate(d.createdAt) >= from) && (!to || fmt.isoDate(d.createdAt) <= to) &&
          (!q || [d.code, d.vehicleNo, d.serialKey, d.transport].some(v => String(v).toUpperCase().replace(/\s/g, '').includes(q)) || d.boxes.some(b => String(b.boxNo || '').toUpperCase().includes(q) || String(b.uid || '').toUpperCase().includes(q))));
        $('#rows').innerHTML = shown.length ? shown.map(d => `<tr class="link" data-id="${d.id}">
          <td><b class="code" style="font-size:13px">${esc(d.code)}</b><div class="mute" style="font-size:12.5px">${fmt.dt(d.createdAt)}</div></td>
          <td><b class="wide">${esc(prettyVehicle(d.vehicleNo))}</b></td><td class="hide-sm">${esc(d.transport)}</td>
          <td class="hide-sm"><div class="person"><div class="avatar" style="width:30px;height:30px;font-size:11px">${initials(d.empName)}</div><div><b>${esc(d.empName)}</b><span>${esc(d.empNo)}</span></div></div></td>
          <td class="num"><b>${d.boxes.length}</b></td><td class="num hide-sm">${fmtW(d.totalWeight)}</td>
          <td><span class="pill ${d.status}">${d.status === 'open' ? 'Loading' : 'Closed'}</span></td></tr>`).join('')
          : `<tr><td colspan="7"><div class="empty"><b>${all.length ? 'No lists match' : 'No lists yet'}</b>${all.length ? 'Clear a filter to see more.' : 'Lists appear here as soon as someone starts loading.'}</div></td></tr>`;
      };
      ['q', 'emp', 'stt', 'from', 'to'].forEach(i => $('#' + i).addEventListener('input', draw));
      if (qs === 'open') $('#stt').value = 'open';
      live(async () => { all = await S.dispatches(); draw(); });
      $('#rows').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = `#/list/${tr.dataset.id}`; };
      $('#rep').onclick = async () => {
        if (!shown.length) return toast('No lists to export', 'bad');
        await loadScript('vendor/xlsx.full.min.js');
        X.reportExcel(shown, SETTINGS, 'dispatch_report');
        await S.log(ME.user, 'report.xlsx', `${shown.length} lists`);
        toast(`Exported ${shown.length} lists`);
      };
      draw();
    }
  });
}, { admin: true });

// ======================================================================
// Admin: employees
// ======================================================================
route(/^\/admin\/people(?:\?(\w+))?$/, async (qs) => {
  const people = await S.users();
  const all = await S.dispatches();
  const stats = id => { const m = all.filter(d => d.createdBy === id); return { lists: m.length, boxes: m.reduce((s, d) => s + d.boxes.length, 0) }; };
  render({
    html: adminShell('#/admin/people', `<main class="page">
      <div class="page-head"><div><h1>People</h1><p>${isSuper(ME.user) ? 'Add managers, employees and other workers. Only people added here can sign in.' : 'Everyone who can sign in. Only Chetan can add or change people.'}</p></div>
        ${isSuper(ME.user) ? `<div class="actions"><button class="btn primary" id="add">${icon('plus')} Add person</button></div>` : ''}</div>
      <div class="panel"><div class="toolbar"><div class="search">${icon('search')}<input class="input" id="q" placeholder="Name, employee no., phone"></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th class="hide-sm">Phone</th><th class="hide-sm">Added</th><th class="hide-sm">Last sign-in</th><th class="num">Boxes</th><th>Status</th></tr></thead>
      <tbody id="rows"></tbody></table></div></div></main>`),
    bind() {
      const draw = () => {
        const q = $('#q').value.trim().toLowerCase();
        const list = people.filter(p => !q || [p.name, p.empNo, p.phone, p.username].some(v => String(v || '').toLowerCase().includes(q)));
        $('#rows').innerHTML = list.map(p => { const st = stats(p.id); return `<tr class="link" data-id="${p.id}">
          <td><div class="person"><div class="avatar">${initials(p.name)}</div><div><b>${esc(p.name)}</b><span>${esc(p.empNo)} · ${esc(p.designation || ROLE_NAME[p.role])}</span></div></div></td>
          <td class="hide-sm">${esc(p.phone)}</td>
          <td class="hide-sm">${fmt.date(p.createdAt)}<div class="mute" style="font-size:12.5px">by ${esc(p.createdByName)}</div></td>
          <td class="hide-sm">${p.lastLogin ? fmt.ago(p.lastLogin) : '<span class="mute">Never</span>'}</td>
          <td class="num"><b>${fmt.num(st.boxes)}</b><div class="mute" style="font-size:12.5px">${st.lists} lists</div></td>
          <td>${!p.active ? '<span class="pill off">Disabled</span>' : p.role === 'super' ? '<span class="pill admin">Admin</span>' : p.role === 'manager' ? '<span class="pill open">Manager</span>' : '<span class="pill closed">Employee</span>'}</td></tr>`; }).join('')
          || `<tr><td colspan="6"><div class="empty"><b>No one found</b>Try another name or number.</div></td></tr>`;
      };
      $('#q').oninput = draw;
      $('#add')?.addEventListener('click', () => personDrawer(null));
      if (qs === 'add') { history.replaceState(null, '', '#/admin/people'); if (isSuper(ME.user)) personDrawer(null); }
      $('#rows').onclick = e => {
        const tr = e.target.closest('tr[data-id]'); if (!tr) return;
        personDrawer(people.find(x => x.id === tr.dataset.id));
      };
      draw();
    }
  });
}, { admin: true });

function personDrawer(p) {
  const isNew = !p; p = p || { role: 'employee' };
  const self = p.id === ME.user.id;
  const ro = !isSuper(ME.user);   // managers look, never change
  const today = fmt.isoDate(Date.now());
  drawer({
    title: isNew ? 'Add person' : esc(p.name),
    body: `${ro ? '<div class="note-line" style="margin-bottom:16px">' + icon('lock') + ' View only. Ask Chetan to change anything here.</div>' : ''}<form id="pf" novalidate><fieldset ${ro ? 'disabled' : ''} style="border:0;margin:0;padding:0;min-width:0">
      <div class="fgroup"><h3>Personal</h3><div class="grid2">
        ${field({ name: 'name', label: 'Full name', value: p.name, span: true, attrs: 'autocomplete="off"' })}
        ${field({ name: 'dob', label: 'Date of birth', type: 'date', value: p.dob, attrs: `max="${today}"` })}
        ${field({ name: 'gender', label: 'Gender', value: p.gender || '', options: [['', 'Select'], 'Male', 'Female', 'Other'] })}
        ${field({ name: 'phone', label: 'Mobile number', type: 'tel', value: p.phone, attrs: 'inputmode="numeric" maxlength="10"' })}
        ${field({ name: 'altPhone', label: 'Alternate number', type: 'tel', value: p.altPhone, opt: true, attrs: 'inputmode="numeric" maxlength="10"' })}
        ${field({ name: 'address', label: 'Address', type: 'textarea', value: p.address, span: true })}
        ${field({ name: 'pincode', label: 'PIN code', value: p.pincode, opt: true, attrs: 'inputmode="numeric" maxlength="6"' })}
        ${field({ name: 'aadhaar', label: 'Aadhaar', value: p.aadhaar ? p.aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ') : '', opt: true, attrs: 'inputmode="numeric" maxlength="14" autocomplete="off"', hint: 'Stored on this device only. Shown masked elsewhere.' })}
      </div></div>
      <div class="fgroup"><h3>Work</h3><div class="grid2">
        ${field({ name: 'empNo', label: 'Employee no.', value: p.empNo, cls: 'code' })}
        ${field({ name: 'designation', label: 'Designation', value: p.designation, attrs: 'list="desig"' })}
        <datalist id="desig"><option>Loader</option><option>Dispatch Supervisor</option><option>Store Assistant</option><option>Security</option><option>Contract Worker</option></datalist>
        ${field({ name: 'joinDate', label: 'Joining date', type: 'date', value: p.joinDate, opt: true, attrs: `max="${today}"` })}
        ${field({ name: 'role', label: 'Access', value: p.role, options: [['employee', 'Employee — scans and sees own lists'], ['manager', 'Manager — sees everything, changes nothing'], ['super', 'Admin — full control, like Chetan']], attrs: self ? 'disabled' : '' })}
      </div></div>
      <div class="fgroup"><h3>Emergency contact</h3><div class="grid2">
        ${field({ name: 'emName', label: 'Name', value: p.emName, opt: true })}
        ${field({ name: 'emPhone', label: 'Mobile', type: 'tel', value: p.emPhone, opt: true, attrs: 'inputmode="numeric" maxlength="10"' })}
      </div></div>
      <div class="fgroup"><h3>Sign-in</h3><div class="grid2">
        ${field({ name: 'username', label: 'Username', value: p.username, attrs: 'autocapitalize="none" autocomplete="off"' })}
        ${isNew ? field({ name: 'password', label: 'Temporary password', type: 'text', value: tempPw(), attrs: 'autocomplete="off"', hint: 'They set their own after first sign-in' }) : ro ? '' : `<div class="field"><div class="lbl">Password</div><button type="button" class="btn" data-reset>${icon('key')} Reset password</button></div>`}
      </div></div>
      ${isNew ? '' : `<div class="fgroup"><h3>Record</h3><div class="audit-box">
        <div><span>Account created</span>${fmt.dt(p.createdAt)}</div>
        <div><span>Created by</span>${esc(p.createdByName)}${p.createdByEmpNo ? ' (' + esc(p.createdByEmpNo) + ')' : ''}</div>
        <div><span>Created from</span>${esc(p.createdFrom || '—')}</div>
        <div><span>Last updated</span>${p.updatedAt ? fmt.dt(p.updatedAt) + (p.updatedBy ? ' by ' + esc(p.updatedBy) : '') : '—'}</div>
        <div><span>Last sign-in</span>${fmt.dt(p.lastLogin)}</div>
        <div><span>Aadhaar</span>${fmt.aadhaar(p.aadhaar)}</div>
      </div></div>`}
    </fieldset></form>`,
    foot: ro ? `<button class="btn" data-cancel>Close</button>` : `${!isNew && !self ? `<button class="btn ghost danger" data-toggle style="margin-right:auto">${icon('ban')} ${p.active ? 'Disable' : 'Enable'}</button>` : ''}
      <button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-save>${isNew ? 'Add person' : 'Save changes'}</button>`,
    onMount(el, close) {
      const f = el.querySelector('#pf');
      el.querySelector('[data-cancel]').onclick = close;
      if (ro) return;
      f.aadhaar.addEventListener('input', e => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); e.target.value = d.replace(/(\d{4})(?=\d)/g, '$1 '); });
      if (isNew) f.name.addEventListener('input', () => { if (!f.username.dataset.touched) f.username.value = f.name.value.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, '') || ''; });
      f.username.addEventListener('input', () => { f.username.dataset.touched = 1; });
      el.querySelector('[data-save]').onclick = async e => {
        const v = formData(f);
        v.username = (v.username || '').trim().toLowerCase();
        v.aadhaar = (v.aadhaar || '').replace(/\s/g, '');
        ['phone', 'altPhone', 'emPhone'].forEach(k => { v[k] = (v[k] || '').replace(/\D/g, '').slice(-10); });
        const errs = {
          name: validate.name(v.name), dob: validate.dob(v.dob), phone: validate.phone(v.phone),
          altPhone: v.altPhone ? validate.phone(v.altPhone) || (v.altPhone === v.phone ? 'Same as mobile number' : '') : '',
          address: (v.address || '').trim().length >= 10 ? '' : 'Enter the full address (at least 10 characters)',
          pincode: validate.pincode(v.pincode), aadhaar: validate.aadhaar(v.aadhaar),
          empNo: validate.empNo(v.empNo), designation: validate.required(v.designation),
          emPhone: v.emPhone ? validate.phone(v.emPhone) : '',
          username: validate.username(v.username), password: isNew ? validate.password(v.password) : ''
        };
        if (!setErrors(f, errs)) return;
        const btn = e.currentTarget; btn.classList.add('busy');
        const data = { ...p, ...v, name: v.name.trim().replace(/\s+/g, ' '), empNo: v.empNo.trim().toUpperCase(), address: v.address.trim() };
        delete data.password;
        if (self) data.role = p.role || 'employee';
        try {
          await S.saveUser(data, ME.user, isNew ? v.password : null);
          close();
          if (isNew) await confirmBox({ title: `${data.name} can sign in now`, text: `Username <b class="code">${esc(data.username)}</b><br>Temporary password <b class="code">${esc(v.password)}</b><br><br>Share these with them in person. They will set their own password at first sign-in.`, ok: 'Done' });
          else toast('Saved');
          go();
        } catch (err) { btn.classList.remove('busy'); toast(err.message, 'bad', 4000); }
      };
      el.querySelector('[data-reset]')?.addEventListener('click', async () => {
        const pw = tempPw();
        if (!(await confirmBox({ title: `Reset password for ${esc(p.name)}?`, text: `The new temporary password will be <b class="code">${pw}</b>. They must change it at next sign-in.`, ok: 'Reset password' }))) return;
        try { await S.resetPassword(p, pw, ME.user); } catch (err) { return toast(err.message, 'bad'); }
        await confirmBox({ title: 'Password reset', text: `Give ${esc(p.name)} this temporary password in person:<br><br><b class="code" style="font-size:20px">${pw}</b>`, ok: 'Done' });
      });
      el.querySelector('[data-toggle]')?.addEventListener('click', async () => {
        if (p.active && !(await confirmBox({ title: `Disable ${esc(p.name)}?`, text: 'They will not be able to sign in. Their lists stay.', ok: 'Disable', danger: true }))) return;
        await S.setUserActive(p, !p.active, ME.user); close(); toast(p.active ? 'Account disabled' : 'Account enabled'); go();
      });
    }
  });
}

function tempPw() {
  const w = ['Dock', 'Crate', 'Valve', 'Pump', 'Gear', 'Truck', 'Label', 'Cargo'];
  return w[crypto.getRandomValues(new Uint8Array(1))[0] % w.length] + (1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 9000);
}

// ======================================================================
// Admin: activity
// ======================================================================
route(/^\/admin\/activity$/, async () => {
  let rows = await S.auditTrail(2000);
  const people = await S.users();
  const sup = isSuper(ME.user);
  const KINDS = [['', 'Everything'], ['auth', 'Sign-ins and sign-outs'], ['list', 'Loading lists'], ['box', 'Boxes'], ['user', 'People'], ['note', 'Notes'], ['settings', 'Settings and backups']];
  render({
    html: adminShell('#/admin/activity', `<main class="page">
      <div class="page-head"><div><h1>Activity</h1><p>Every sign-in, list, box and account change, newest first.${sup ? ' Tap a line to correct or delete it.' : ''}</p></div>
        ${sup ? `<div class="actions"><button class="btn primary" id="addNote">${icon('note')} Add entry</button></div>` : ''}</div>
      <div class="panel">
        <div class="toolbar">
          <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search what happened"></div>
          <select class="input" id="who"><option value="">Everyone</option>${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <select class="input" id="kind">${KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          <input class="input" type="date" id="day" aria-label="Day">
        </div>
        <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody id="rows"></tbody></table></div>
      </div></main>`),
    bind() {
      const draw = () => {
        const q = $('#q').value.trim().toLowerCase(), who = $('#who').value, kind = $('#kind').value, day = $('#day').value;
        const list = rows.filter(a => (!who || a.by === who) &&
          (!kind || (kind === 'settings' ? /^(settings|data|demo|audit)/.test(a.action) : a.action.split('.')[0] === kind)) &&
          (!day || fmt.isoDate(a.at) === day) && (!q || describe(a).toLowerCase().includes(q) || String(a.byName).toLowerCase().includes(q))).slice(0, 500);
        $('#rows').innerHTML = list.map(a => `<tr class="${sup ? 'link' : ''}" data-id="${a.id}"><td class="mute" style="white-space:nowrap">${fmt.dt(a.at)}</td><td><b>${esc(a.byName)}</b></td><td>${a.action === 'note' ? `<span class="pill note">Note</span> ` : ''}${esc(describe(a))}${a.editedBy ? ` <span class="mute" style="font-size:12px">(edited by ${esc(a.editedBy)})</span>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="3"><div class="empty"><b>Nothing found</b>Clear a filter to see more.</div></td></tr>';
      };
      ['q', 'who', 'kind', 'day'].forEach(i => $('#' + i).addEventListener('input', draw));
      const reload = async () => { rows = await S.auditTrail(2000); draw(); };
      const editor = a => drawer({
        title: a ? 'Edit activity entry' : 'Add activity entry',
        body: `<form id="af" style="display:grid;gap:14px" novalidate>
          ${a ? `<p class="mute" style="margin:0">${esc(a.byName)} · ${esc(ACTIONS[a.action] || a.action)}</p>` : ''}
          ${field({ name: 'detail', label: a ? 'Details' : 'What happened', type: 'textarea', value: a ? a.detail : '' })}
          ${field({ name: 'at', label: 'When', type: 'datetime-local', value: new Date((a ? a.at : Date.now()) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) })}
        </form>`,
        foot: `${a ? `<button class="btn ghost danger" data-del style="margin-right:auto">${icon('trash')} Delete entry</button>` : ''}<button class="btn primary" data-save>${a ? 'Save changes' : 'Add entry'}</button>`,
        onMount(el, close) {
          el.querySelector('[data-save]').onclick = async () => {
            const f = el.querySelector('#af'); const v = formData(f);
            if (!a && !setErrors(f, { detail: validate.required(v.detail) })) return;
            const at = v.at ? new Date(v.at).getTime() : Date.now();
            if (a) await S.editAudit(a.id, { detail: v.detail.trim(), at }, ME.user); else await S.addNote(ME.user, v.detail.trim(), at);
            close(); toast(a ? 'Entry updated' : 'Entry added'); reload();
          };
          el.querySelector('[data-del]')?.addEventListener('click', async () => {
            if (!(await confirmBox({ title: 'Delete this entry?', text: 'It is removed from the log. A line saying you deleted it is kept.', ok: 'Delete', danger: true }))) return;
            await S.deleteAudit(a.id, ME.user); close(); toast('Entry deleted'); reload();
          });
        }
      });
      if (sup) {
        $('#addNote').onclick = () => editor(null);
        $('#rows').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) editor(rows.find(a => a.id === tr.dataset.id)); };
      }
      draw();
    }
  });
}, { admin: true });

// ======================================================================
// Admin: settings
// ======================================================================
route(/^\/admin\/settings$/, async () => {
  const s = SETTINGS;
  const bk = await S.lastBackup();
  const chips = (k) => s[k].map((t, i) => `<span class="chip">${esc(t)}<button data-rm="${k}:${i}" aria-label="Remove ${esc(t)}">${icon('x')}</button></span>`).join('');
  render({
    html: adminShell('#/admin/settings', `<main class="page">
      <div class="page-head"><div><h1>Settings</h1><p>Printouts, drop-down lists, backups and the master PIN. Only Chetan sees this page.</p></div>
        <div class="actions"><a class="btn" href="#/admin/activity">${icon('activity')} Activity log</a></div></div>
      <div class="settings-grid">
        <div class="panel"><div class="panel-head"><h2>Printout header</h2></div><form class="panel-body" id="hf" style="display:grid;gap:14px">
          ${field({ name: 'company', label: 'Company name', value: s.company })}
          ${field({ name: 'docTitle', label: 'Document title', value: s.docTitle })}
          ${field({ name: 'plant', label: 'Plant / unit', value: s.plant, opt: true })}
          <div><button class="btn primary" type="submit">Save header</button></div></form></div>
        <div class="panel"><div class="panel-head"><h2>Rules</h2></div><div class="panel-body">
          <label class="check"><input type="checkbox" id="rp" ${s.requirePhotoBeforeScan ? 'checked' : ''}><div><b>Driver photo before scanning</b><span>Scanning stays locked until the photo is taken.</span></div></label>
          <label class="check"><input type="checkbox" id="cx" ${s.blockCrossListDuplicates ? 'checked' : ''}><div><b>Block boxes already on another list</b><span>Stops one box being loaded on two vehicles.</span></div></label>
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Transporters</h2></div><div class="panel-body">
          <div class="chips">${chips('transporters')}</div>
          <form class="inline" data-add="transporters"><input class="input" placeholder="Add a transporter" required><button class="btn">${icon('plus')} Add</button></form></div></div>
        <div class="panel"><div class="panel-head"><h2>Locations</h2></div><div class="panel-body">
          <div class="chips">${chips('locations')}</div>
          <form class="inline" data-add="locations"><input class="input" placeholder="Add a location" required><button class="btn">${icon('plus')} Add</button></form></div></div>
        <div class="panel"><div class="panel-head"><h2>Master PIN</h2></div><div class="panel-body" style="display:grid;gap:12px">
          <p class="mute" style="margin:0;font-size:14px">Resets any password from the sign-in screen, including the admin's. Five wrong tries lock it for 10 minutes.</p>
          <div><button class="btn" id="mpin">${icon('key')} Change master PIN</button></div></div></div>
        <div class="panel"><div class="panel-head"><h2>Data</h2></div><div class="panel-body" style="display:grid;gap:12px">
          <p class="mute" style="margin:0;font-size:14px">Everything is saved on this device, in this browser. Back up once a week.${googleOn() ? ' Backups go to your Google Drive, in a folder called <b>Yuken POL backups</b>.' : ' Turn on Google (see AGENTS.md) to back up straight to Google Drive.'}</p>
          <p style="margin:0;font-size:14px"><b>Last backup:</b> ${bk ? `${fmt.dt(bk.at)} to ${esc(bk.where)}` : 'never'}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn primary" id="bk">${icon(googleOn() ? 'cloud' : 'download')} ${googleOn() ? 'Back up to Google Drive' : 'Download backup'}</button>
            ${googleOn() ? `<button class="btn" id="rsd">${icon('upload')} Restore from Google Drive</button><button class="btn ghost" id="bkf">${icon('download')} Download a copy</button>` : ''}
            <label class="btn">${icon('upload')} Restore from file<input type="file" accept=".json" id="rs" class="sr"></label>
            <button class="btn" id="demo">${icon('play')} Load demo data</button>
          </div></div></div>
      </div></main>`),
    bind() {
      const save = async patch => { SETTINGS = await S.saveSettings(patch, ME.user); };
      $('#hf').onsubmit = async e => { e.preventDefault(); const v = formData(e.target); if (!setErrors(e.target, { company: validate.required(v.company), docTitle: validate.required(v.docTitle) })) return; await save(v); toast('Header saved'); };
      $('#rp').onchange = e => save({ requirePhotoBeforeScan: e.target.checked }).then(() => toast('Saved'));
      $('#cx').onchange = e => save({ blockCrossListDuplicates: e.target.checked }).then(() => toast('Saved'));
      $$('[data-add]').forEach(f => f.onsubmit = async e => {
        e.preventDefault(); const k = f.dataset.add; const v = f.querySelector('input').value.trim();
        if (!v) return; if (s[k].some(x => x.toLowerCase() === v.toLowerCase())) return toast('Already in the list', 'bad');
        await save({ [k]: [...s[k], v] }); go();
      });
      $$('[data-rm]').forEach(b => b.onclick = async () => { const [k, i] = b.dataset.rm.split(':'); await save({ [k]: s[k].filter((_, j) => j !== +i) }); go(); });
      $('#mpin').onclick = () => formDialog({
        title: 'Change master PIN',
        text: 'Use 8 to 16 digits. Write it down and keep it somewhere safe, away from this computer.',
        body: `${field({ name: 'cur', label: 'Current master PIN', type: 'password', attrs: 'inputmode="numeric"' })}${field({ name: 'next', label: 'New master PIN', type: 'password', attrs: 'inputmode="numeric"' })}${field({ name: 'again', label: 'Type it again', type: 'password', attrs: 'inputmode="numeric"' })}`,
        ok: 'Change PIN',
        async onSubmit(v, form) {
          const digits = String(v.next).replace(/\D/g, '');
          if (!setErrors(form, { cur: validate.required(v.cur), next: /^\d{8,16}$/.test(digits) && digits === v.next ? '' : '8 to 16 digits, numbers only', again: v.again === v.next ? '' : 'PINs do not match' })) return false;
          await S.changeMasterPin(v.cur, v.next, ME.user);
          return true;
        }
      }).then(ok => ok && toast('Master PIN changed'));
      $('#bk').onclick = e => backupNow(e.currentTarget);
      $('#bkf')?.addEventListener('click', async () => {
        const { download } = await import('./util.js');
        download(new Blob([JSON.stringify(await S.backup())], { type: 'application/json' }), `yuken-backup-${fmt.isoDate(Date.now())}.json`);
        await S.markBackup('file download', ME.user); toast('Backup file downloaded');
      });
      $('#rsd')?.addEventListener('click', async e => {
        const btn = e.currentTarget; btn.classList.add('busy');
        try {
          const { files, open } = await driveList(ME.user.googleEmail);
          btn.classList.remove('busy');
          if (!files.length) return toast('No backups in Google Drive yet', 'bad');
          drawer({
            title: 'Restore from Google Drive',
            body: `<p class="mute" style="margin-top:0">Pick a backup. Everything on this device is replaced with it.</p><div class="pick">${files.map(f => `<button class="btn" data-f="${f.id}">${icon('cloud')} <span>${esc(f.name)}</span><small>${fmt.dt(new Date(f.modifiedTime).getTime())} · ${Math.round((+f.size || 0) / 1024)} KB</small></button>`).join('')}</div>`,
            onMount(el, close) {
              el.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => {
                if (!(await confirmBox({ title: 'Restore this backup?', text: 'Everything on this device is replaced. Everyone signs in again.', ok: 'Restore', danger: true }))) return;
                b.classList.add('busy');
                try { await S.restore(await open(b.dataset.f)); close(); await S.logout(); toast('Backup restored'); location.hash = '#/login'; go(); }
                catch (err) { b.classList.remove('busy'); toast(err.message, 'bad'); }
              });
            }
          });
        } catch (err) { btn.classList.remove('busy'); toast(err.message, 'bad', 5000); }
      });
      if ($('#rs')) $('#rs').onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        if (!(await confirmBox({ title: 'Restore this backup?', text: 'Everything in this browser is replaced with the backup. You will need to sign in again.', ok: 'Restore', danger: true }))) return;
        try { await S.restore(JSON.parse(await file.text())); await S.logout(); toast('Backup restored'); location.hash = '#/login'; go(); }
        catch (err) { toast(err.message, 'bad'); }
      };
      $('#demo').onclick = async e => {
        const btn = e.currentTarget;
        if (!(await confirmBox({ title: 'Load demo data?', text: 'Adds three sample employees (password <b class="code">yuken2026</b>) and ten sample lists from the last five days. Use it to show the app, then restore a clean backup.', ok: 'Load demo data' }))) return;
        btn.classList.add('busy');
        try { await S.seedDemo(ME.user); toast('Demo data loaded'); location.hash = '#/admin'; }
        catch (err) { btn.classList.remove('busy'); toast(err.message, 'bad', 5000); }
      };
    }
  });
}, { super: true });

// ---------- boot ----------
const hideBoot = () => { const b = $('#boot'); if (!b) return; setTimeout(() => { b.classList.add('gone'); clearInterval(window.__boot); setTimeout(() => b.remove(), 450); }, 350); };
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
go().then(hideBoot);
