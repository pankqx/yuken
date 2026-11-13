// Small helpers shared across views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmt = {
  date(ts) { if (!ts) return '—'; const d = new Date(ts); return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; },
  time(ts) { if (!ts) return '—'; const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  dt(ts) { return ts ? `${fmt.date(ts)}, ${fmt.time(ts)}` : '—'; },
  kg(n) { const v = Number(n) || 0; return v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' kg'; },
  num(n) { return (Number(n) || 0).toLocaleString('en-IN'); },
  ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return fmt.date(ts);
  },
  dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; },
  isoDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
  aadhaar(v) { return v ? 'XXXX XXXX ' + String(v).slice(-4) : '—'; }
};

export const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// ---------- Password hashing (PBKDF2, salted) ----------
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function hashPassword(password, salt, iterations = 120000) {
  salt = salt || hex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, 256);
  return { salt, hash: hex(bits) };
}

// ---------- Validation ----------
// Verhoeff checksum — every real Aadhaar number passes it.
const vD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const vP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeff(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  digits.forEach((d, i) => { c = vD[c][vP[i % 8][d]]; });
  return c === 0;
}

export const validate = {
  required: v => (String(v ?? '').trim() ? '' : 'Required'),
  name: v => (/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(String(v).trim()) ? '' : 'Letters only, 2–60 characters'),
  phone: v => (/^[6-9]\d{9}$/.test(String(v).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')) ? '' : 'Enter a 10-digit mobile number starting 6–9'),
  dob: v => {
    if (!v) return 'Required';
    const d = new Date(v), now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
    if (isNaN(age)) return 'Invalid date';
    if (age < 18) return 'Employee must be 18 or older';
    if (age > 75) return 'Check the year';
    return '';
  },
  aadhaar: v => {
    const s = String(v || '').replace(/\s/g, '');
    if (!s) return '';
    if (!/^[2-9]\d{11}$/.test(s)) return 'Aadhaar is 12 digits and does not start with 0 or 1';
    return verhoeff(s) ? '' : 'This Aadhaar number fails the checksum — check for a typo';
  },
  empNo: v => (/^[A-Za-z0-9-]{2,12}$/.test(String(v).trim()) ? '' : '2–12 letters, digits or dashes'),
  username: v => (/^[a-z0-9._]{3,24}$/.test(String(v).trim()) ? '' : '3–24 lowercase letters, digits, dot or underscore'),
  password: v => (String(v).length >= 8 && /\d/.test(v) && /[A-Za-z]/.test(v) ? '' : 'At least 8 characters with a letter and a number'),
  vehicle: v => (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/.test(normVehicle(v)) ? '' : 'Use the plate format, e.g. KA19AB1234'),
  pincode: v => (!v || /^[1-9]\d{5}$/.test(v) ? '' : '6-digit PIN code')
};

export const normVehicle = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const prettyVehicle = v => {
  const n = normVehicle(v);
  const m = n.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : n;
};

// ---------- Image capture ----------
export function compressImage(file, max = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ---------- Feedback ----------
let audio;
export function beep(kind = 'ok') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'ok' ? [[1320, 0.07]] : kind === 'dup' ? [[420, 0.12], [320, 0.16]] : [[220, 0.25]];
    let t = audio.currentTime;
    for (const [f, d] of tones) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = kind === 'ok' ? 'sine' : 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + d + 0.02); t += d + 0.04;
    }
  } catch { /* audio not available */ }
  if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 30 : [60, 40, 60]);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
