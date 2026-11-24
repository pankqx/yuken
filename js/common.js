// Pieces shared across the data store: duplicate rules, totals, demo data.

export const DEFAULT_SETTINGS = {
  id: 'app',
  company: 'Yuken India Limited',
  docTitle: 'FG Proof of Loading (POL)',
  plant: 'Whitefield, Bengaluru',
  transporters: ['Collection – Personal collection', 'VRL Logistics', 'Safexpress', 'Gati', 'TCI Express', 'Blue Dart', 'Delhivery'],
  locations: ['FG Store – Dock 1', 'FG Store – Dock 2', 'Export Bay', 'Plant 2 Dispatch'],
  requirePhotoBeforeScan: true,
  blockCrossListDuplicates: true,
  cameraAllCodes: false
};

export const SHIFT_MS = 14 * 3600 * 1000;

const up = v => String(v ?? '').trim().toUpperCase();

// Same box if the unique ID, the box number or the raw key matches —
// so a box scanned once by its barcode and again by its QR is still caught.
export const sameBox = (a, b) => a.key === b.key || (a.uid && up(a.uid) === up(b.uid)) || (a.boxNo && up(a.boxNo) === up(b.boxNo));

// Every identity a box can be recognised by, for the cross-list index.
export const boxIds = b => [...new Set([b.uid, b.boxNo, b.key].filter(Boolean).map(up))];

// Accept both decimal-comma labels ("12,5") and grouped values
// ("1,234.5" / "1.234,5") without silently dropping most of the weight.
export function weightNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    s = s.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const decimals = s.length - comma - 1;
    s = decimals > 0 && decimals <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1) {
    const last = s.lastIndexOf('.');
    s = s.slice(0, last).replace(/\./g, '') + s.slice(last);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function totals(d) {
  d.totalBoxes = d.boxes.length;
  d.labelWeight = +d.boxes.reduce((s, b) => s + (weightNumber(b.weight) || 0), 0).toFixed(2);
  d.totalWeight = d.weightEntered ?? d.labelWeight;
  return d;
}

export const renumber = boxes => boxes.map((b, i) => ({ ...b, seq: i + 1 }));

// Firestore rejects `undefined`; JSON round-trip drops it.
export const clean = o => JSON.parse(JSON.stringify(o));

export const DEMO_PEOPLE = [
  { name: 'Babu Shetty', empNo: '3065', username: 'babu', dob: '1991-03-14', phone: '9845012345', address: '2nd Cross, Hoodi, Bengaluru', pincode: '560048', designation: 'Dispatch Supervisor', role: 'employee' },
  { name: 'Ravi Kumar', empNo: '3112', username: 'ravi', dob: '1996-08-02', phone: '9886023411', address: 'Kadugodi Main Road, Bengaluru', pincode: '560067', designation: 'Loader', role: 'employee' },
  { name: 'Imran Pasha', empNo: '3140', username: 'imran', dob: '1994-11-21', phone: '9741200987', address: 'Old Madras Road, KR Puram, Bengaluru', pincode: '560036', designation: 'Store Assistant', role: 'employee' }
];
export const DEMO_PASSWORD = 'yuken2026';

// Builds sample lists for the demo; the store decides how to save them.
export async function demoLists(people, settings) {
  const { parseScan, sampleLabel } = await import('./parse.js');
  const out = [];
  let n = 100;
  for (let day = 4; day >= 0; day--) {
    for (let k = 0; k < 2; k++) {
      const u = people[(day + k) % people.length];
      // spread lists across the working day: 10:15 and 15:30, never in the future
      const d0 = new Date(Date.now() - day * 86400000); d0.setHours(k ? 15 : 10, k ? 30 : 15, 0, 0);
      const t = Math.min(d0.getTime(), Date.now() - (k ? 40 : 130) * 60000);
      const count = 6 + ((day * 3 + k * 5) % 9);
      const boxes = [];
      for (let i = 0; i < count; i++) boxes.push({ ...parseScan(sampleLabel(n++)), seq: i + 1, scannedAt: t + i * 45000, by: u.name, empNo: u.empNo, via: i % 3 ? 'scanner' : 'camera' });
      const closed = day > 0 || k === 0;
      out.push(totals({
        createdAt: t, loginAt: t - 600000, user: u,
        vehicleNo: ['KA19AB4521', 'KA01MK7781', 'TN09BQ1150', 'KA53C2207'][(day + k) % 4],
        transport: settings.transporters[(day + k) % settings.transporters.length],
        serialKey: `PCL0026-${4000 + day * 10 + k}`,
        location: settings.locations[k % settings.locations.length],
        driverName: ['Manjunath', 'Shivakumar', 'Prakash', 'Anand'][(day + k) % 4],
        driverPhone: '98450' + String(10000 + day * 37 + k).slice(-5),
        status: closed ? 'closed' : 'open',
        closedAt: closed ? t + count * 45000 + 120000 : null,
        closedBy: closed ? u.name : null,
        boxes
      }));
    }
  }
  return out;
}

export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
export const listCode = (ts, seq) => `POL-${dayKey(ts)}-${String(seq).padStart(3, '0')}`;

// A box first saved from its plain barcode (box number only) can be completed
// by scanning its QR code: copy the details the saved box is missing.
// Returns the field names that were filled in (empty = nothing new).
const DETAIL_FIELDS = ['weight', 'item', 'qty', 'uid', 'datePacked', 'customer', 'shipTo', 'transporter', 'packingSlip', 'boxIndex'];
export function fillMissing(prev, rec) {
  const added = [];
  for (const f of DETAIL_FIELDS) {
    if ((prev[f] == null || prev[f] === '') && rec[f] != null && rec[f] !== '') { prev[f] = rec[f]; added.push(f); }
  }
  if (rec.extra) for (const [k, v] of Object.entries(rec.extra)) if (!(prev.extra || {})[k]) { (prev.extra ||= {})[k] = v; added.push(k); }
  if (added.length && rec.raw && rec.raw.length > (prev.raw || '').length) prev.raw = rec.raw;
  return added;
}
