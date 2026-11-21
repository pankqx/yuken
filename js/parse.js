// Turns whatever the scanner reads into a structured box record.
// Handles: a bare box number ("4270036177-3"), JSON, and "Key: value"
// text in any delimiter (new lines, |, ;, tabs) — the fields printed on
// Yuken master-box labels.
import { weightNumber } from './common.js';

const FIELDS = [
  ['boxNo',       /^(ps\s*)?box\s*(num(ber)?|no\.?)?$|^packing\s*slip|^ps\s*no|^box$/i],
  ['uid',         /unique|^uid|serial\s*no|ids?\s*packed/i],
  ['weight',      /weight|\bwt\b|^kgs?$|gross|net\s*wt/i],
  ['datePacked',  /date|packed/i],
  ['customer',    /^customer|^cust/i],
  ['shipTo',      /ship\s*-?\s*to|consignee|deliver/i],
  ['transporter', /transport|carrier/i],
  ['item',        /item|part|desc|model|material/i],
  ['qty',         /^qty|quantity|pcs/i]
];

export const FIELD_LABELS = {
  boxNo: 'Box no.', packingSlip: 'Packing slip', boxIndex: 'Box', weight: 'Weight', datePacked: 'Packed on',
  customer: 'Customer', shipTo: 'Ship to', transporter: 'Transporter', item: 'Item', qty: 'Qty', uid: 'Unique ID'
};

function keyFor(label) {
  const l = label.trim();
  for (const [k, re] of FIELDS) if (re.test(l)) return k;
  return null;
}

function finish(rec, raw) {
  rec.raw = raw;
  if (rec.boxNo) {
    rec.boxNo = String(rec.boxNo).trim();
    const m = rec.boxNo.match(/^(\d+)-(\d+)$/);
    if (m) { rec.packingSlip = m[1]; rec.boxIndex = m[2]; }
  }
  if (rec.weight != null) rec.weight = parseWeight(rec.weight);
  if (rec.qty != null) {
    const q = parseInt(String(rec.qty).replace(/\D/g, ''), 10);
    rec.qty = isNaN(q) ? null : q;
  }
  // The key used to block duplicates: the unique ID if the label has one,
  // otherwise the box number, otherwise the raw text.
  rec.key = (rec.uid || rec.boxNo || raw).toString().trim().toUpperCase();
  return rec;
}

// "28.7", "28.7 kg", "28,7", "1,234.5 KGS", "28.700" → a number in kg.
// Grams ("28700 g") are turned into kg. Anything unreadable → null.
export function parseWeight(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim().toLowerCase();
  const m = t.match(/\d[\d.,]*/);                     // first number on the label
  if (!m) return null;
  let w = weightNumber(m[0].replace(/[.,]$/, ''));   // handles 28,7 · 1,234.5 · 1.234,5
  if (w == null) return null;
  if (/\d\s*(g|gm|gms|grams?)\b/.test(t) && !/kg/.test(t)) w /= 1000;   // grams → kg
  return Math.round(w * 1000) / 1000;
}

export function parseScan(input) {
  const raw = String(input || '').replace(/\r/g, '').trim();
  if (!raw) return null;

  // JSON payload
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      const rec = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = keyFor(k) || (k in FIELD_LABELS ? k : null);
        if (key) rec[key] = v; else (rec.extra ||= {})[k] = v;
      }
      return finish(rec, raw);
    } catch { /* fall through */ }
  }

  // Key: value payload. Labels typed on one line ("PS Box Num: 1-3 Box Weight: 28.7 …")
  // are split in front of each known field name.
  const LABELS = /(?=\b(?:PS\s*Box\s*Num|Box\s*No|(?:Box|Gross|Net)\s*(?:Weight|Wt)|(?<!(?:Box|Gross|Net)\s*)Weight|Date\s*Packed|Customer|Ship[\s-]*To|Transporter|Item\s*Description|Item|Qty|Unique\s*IDs?(?:\s*packed)?)\s*[:=])/i;
  let text = raw;
  if (!/[\n|;\t]/.test(raw) && (raw.match(/[:=]/g) || []).length >= 2) text = raw.split(LABELS).join('\n');
  const parts = text.split(/\n|\||;|\t/).map(s => s.trim()).filter(Boolean);
  const kv = parts.filter(p => /[:=]/.test(p));
  if (kv.length >= 2) {
    const rec = {};
    for (const p of kv) {
      const i = p.search(/[:=]/);
      const k = keyFor(p.slice(0, i));
      const v = p.slice(i + 1).trim();
      if (k && v && rec[k] == null) rec[k] = v;
      else if (!k) (rec.extra ||= {})[p.slice(0, i).trim()] = v;
    }
    if (!rec.boxNo && !rec.uid) rec.boxNo = parts[0];
    return finish(rec, raw);
  }

  // Positional CSV the way some label printers encode it:
  // boxNo, weight, date, customer, shipTo, transporter, item, qty, uid
  if (parts.length === 1 && raw.split(',').length >= 5) {
    const c = raw.split(',').map(s => s.trim());
    const [boxNo, weight, datePacked, customer, shipTo, transporter, item, qty, uid] = c;
    return finish({ boxNo, weight, datePacked, customer, shipTo, transporter, item, qty, uid }, raw);
  }

  // Bare code
  return finish({ boxNo: raw }, raw);
}

// Build a sample payload — used by the demo and the "Test label" button.
export function sampleLabel(n = 1) {
  const slip = 4270036177 + Math.floor(n / 6);
  return [
    `PS Box Num: ${slip}-${(n % 6) + 1}`,
    `Box Weight: ${(18 + ((n * 7.3) % 14)).toFixed(1)}`,
    'Date Packed: 12-Nov-26',
    'Customer: Grow-Wel Engineering Export',
    'Ship-To: Grow-Wel Engineering Export',
    'Transporter: COLLECTION - Personal collection',
    `Item Description: ${['HPV3M-50-F-LAL-K1-10', 'DSG-01-3C2-D24-70', 'MSW-03-X-10', 'CPG-06-50-50'][n % 4]}`,
    'Qty: 1',
    `Unique ID: Y26462269200000${String(31 + n).padStart(3, '0')}`
  ].join('\n');
}
