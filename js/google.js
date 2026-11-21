// Google sign-in and Google Drive backup, with no server and no cost.
// Uses Google Identity Services (a popup) to get a short-lived access token.
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadScript } from './camera.js';

export const googleOn = () => !!GOOGLE_CLIENT_ID;
const FOLDER = 'Yuken POL backups';
const DRIVE = 'https://www.googleapis.com/drive/v3';

async function token(scope, hint) {
  if (!googleOn()) throw new Error('Google is not set up yet. Add the client ID in js/config.js.');
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const c = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope, login_hint: hint || undefined,
      callback: r => r.error ? reject(new Error('Google: ' + (r.error_description || r.error))) : resolve(r.access_token),
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? 'Google window was closed.' : 'Google sign-in did not finish. Allow pop-ups and try again.'))
    });
    c.requestAccessToken({ prompt: hint ? '' : 'select_account' });
  });
}

const api = async (t, url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Google Drive said ${r.status}. Try again.`);
  return r;
};

// Who is signing in: { email, name }
export async function googleProfile() {
  const t = await token('openid email profile');
  const me = await (await api(t, 'https://www.googleapis.com/oauth2/v3/userinfo')).json();
  return { email: me.email, name: me.name };
}

async function folder(t) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const f = (await (await api(t, `${DRIVE}/files?q=${q}&fields=files(id)`)).json()).files?.[0];
  if (f) return f.id;
  const made = await (await api(t, `${DRIVE}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).json();
  return made.id;
}

// Upload one backup file. drive.file scope: the app only sees files it made.
export async function driveBackup(data, hint) {
  const t = await token('https://www.googleapis.com/auth/drive.file', hint);
  const parent = await folder(t);
  const name = `yuken-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [parent], mimeType: 'application/json' })], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  await api(t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  return name;
}

// The newest backups first: [{ id, name, modifiedTime, size }]
export async function driveList(hint) {
  const t = await token('https://www.googleapis.com/auth/drive.file', hint);
  const parent = await folder(t);
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const files = (await (await api(t, `${DRIVE}/files?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime,size)`)).json()).files || [];
  return { files, open: async id => (await api(t, `${DRIVE}/files/${id}?alt=media`)).json() };
}
