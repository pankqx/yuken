// Pieces shared across the data store: duplicate rules, totals, demo data.

export const DEFAULT_SETTINGS = {
  id: 'app',
  company: 'Yuken India Limited',
  docTitle: 'FG Proof of Loading (POL)',
  plant: 'Whitefield, Bengaluru',
  transporters: ['Collection – Personal collection', 'VRL Logistics', 'Safexpress', 'Gati', 'TCI Express', 'Blue Dart', 'Delhivery'],
  locations: ['FG Store – Dock 1', 'FG Store – Dock 2', 'Export Bay', 'Plant 2 Dispatch'],
  requirePhotoBeforeScan: true,
  blockCrossListDuplicates: true
};

export const SHIFT_MS = 14 * 3600 * 1000;

const up = v => String(v ?? '').trim().toUpperCase();

// Same box if the unique ID, the box number or the raw key matches —
// so a box scanned once by its barcode and again by its QR is still caught.
export const sameBox = (a, b) => a.key === b.key || (a.uid && up(a.uid) === up(b.uid)) || (a.boxNo && up(a.boxNo) === up(b.boxNo));

// Every identity a box can be recognised by, for the cross-list index.
export const boxIds = b => [...new Set([b.uid, b.boxNo, b.key].filter(Boolean).map(up))];

export function totals(d) {
  d.totalBoxes = d.boxes.length;
  d.labelWeight = +d.boxes.reduce((s, b) => s + (Number(b.weight) || 0), 0).toFixed(2);
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
