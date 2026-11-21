// Excel, PDF, print and share for dispatch lists.
import { fmt, esc, download, prettyVehicle } from './util.js';
import { totals } from './common.js';

const fileBase = d => d.limited ? `${d.code}_boxes` : `${d.code}_${prettyVehicle(d.vehicleNo).replace(/\s/g, '')}`;

// People without the "full details" permit get a box-number-only copy of a
// list. Nothing else leaves the app: no weights, vehicle, driver or photo.
export const limitView = d => ({
  id: d.id, code: d.code, status: d.status, createdAt: d.createdAt, closedAt: d.closedAt, limited: true,
  boxes: d.boxes.map(b => ({ seq: b.seq, key: b.key, boxNo: b.boxNo || b.key, scannedAt: b.scannedAt }))
});

const boxRow = (b, d) => ({
  '#': b.seq,
  'Box no.': b.boxNo || '',
  'Unique ID': b.uid || '',
  'Item': b.item || '',
  'Qty': b.qty ?? '',
  'Weight (kg)': b.weight != null ? Number(b.weight) : '',
  'Packed on': b.datePacked || '',
  'Customer': b.customer || '',
  'Ship to': b.shipTo || '',
  'Scanned at': fmt.dt(b.scannedAt),
  'Scanned by': b.by || d.empName,
  'Via': b.via || ''
});

// ---------- Excel ----------
export function toExcel(d, settings) {
  const XLSX = window.XLSX;
  if (d.limited) {
    const ws = XLSX.utils.aoa_to_sheet([[settings.company], ['Box list'], [], ['List', d.code], ['Date', fmt.dt(d.createdAt)], ['Total boxes', d.boxes.length], [], ['#', 'Box no.'], ...d.boxes.map(b => [b.seq, b.boxNo])]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Boxes');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const head = [
    [settings.company],
    [settings.docTitle],
    [],
    ['List', d.code, '', 'Status', d.status === 'closed' ? 'Closed' : 'Open'],
    ['Employee', `${d.empName} (${d.empNo})`, '', 'Login time', fmt.dt(d.loginAt)],
    ['Vehicle no.', prettyVehicle(d.vehicleNo), '', 'Transport', d.transport],
    ['Location', d.location, '', d.serialKey ? 'Serial key' : '', d.serialKey || ''],
    ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(' · '), '', 'Created', fmt.dt(d.createdAt)],
    ['Total boxes', d.boxes.length, '', 'Total weight (kg)', d.totalWeight ?? 0],
    []
  ];
  const ws = XLSX.utils.aoa_to_sheet(head);
  XLSX.utils.sheet_add_json(ws, d.boxes.map(b => boxRow(b, d)), { origin: -1 });
  ws['!cols'] = [6, 18, 22, 24, 6, 11, 12, 28, 28, 18, 16, 9].map(w => ({ wch: w }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Boxes');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadExcel(d, s) { download(toExcel(d, s), fileBase(d) + '.xlsx'); }

// Many lists → one workbook (admin report)
export function reportExcel(lists, settings, label = 'report') {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const summary = lists.map(d => ({
    'List': d.code, 'Status': d.status, 'Date': fmt.date(d.createdAt), 'Employee': d.empName, 'Emp no.': d.empNo,
    'Vehicle': prettyVehicle(d.vehicleNo), 'Transport': d.transport, 'Location': d.location,
    'Driver': d.driverName || '', 'Boxes': d.boxes.length, 'Weight (kg)': d.totalWeight ?? 0, 'Closed at': d.closedAt ? fmt.dt(d.closedAt) : ''
  }));
  const s1 = XLSX.utils.json_to_sheet(summary);
  s1['!cols'] = [20, 8, 12, 18, 8, 14, 24, 16, 18, 14, 7, 11, 18].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, s1, 'Lists');
  const boxes = lists.flatMap(d => d.boxes.map(b => ({ 'List': d.code, 'Vehicle': prettyVehicle(d.vehicleNo), ...boxRow(b, d) })));
  const s2 = XLSX.utils.json_to_sheet(boxes);
  s2['!cols'] = [20, 14, 5, 18, 22, 24, 6, 11, 12, 28, 28, 18, 16, 9].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, s2, 'All boxes');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([out]), `Yuken_${label}_${fmt.isoDate(Date.now())}.xlsx`);
}

// ---------- PDF ----------
let logoCache;
async function logoPNG() {
  if (logoCache) return logoCache;
  const img = new Image();
  img.src = 'assets/yuken-logo-white.svg';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 852; c.height = 232;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return (logoCache = c.toDataURL('image/png'));
}

const kg = n => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function toPDF(d, settings) {
  if (d.limited) return toPDFLimited(d, settings);
  d = totals({ ...d, boxes: [...d.boxes] });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 12;
  const blue = [4, 159, 224], navy = [11, 33, 64], ink = [19, 32, 47], mute = [60, 108, 140], tint = [234, 246, 253];

  // header band
  doc.setFillColor(...navy); doc.rect(0, 0, W, 34, 'F');
  doc.setFillColor(15, 55, 101); doc.triangle(120, 0, W, 0, W, 34, 'F');
  doc.setFillColor(...blue); doc.rect(0, 34, W, 1.2, 'F');
  try { doc.addImage(await logoPNG(), 'PNG', M, 9, 33, 9); } catch { /* logo optional */ }
  doc.setTextColor(191, 230, 250); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.text('INDIA LIMITED', M, 23);
  doc.setTextColor(255); doc.setFontSize(14);
  doc.text(settings.docTitle, 56, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(191, 230, 250);
  doc.text(settings.company + (settings.plant ? '  |  ' + settings.plant : ''), 56, 21);
  doc.setFont('courier', 'bold'); doc.setFontSize(10.5); doc.setTextColor(255);
  doc.text(d.code, W - M, 15, { align: 'right' });
  const closed = d.status === 'closed';
  doc.setFillColor(...(closed ? [55, 214, 155] : [255, 181, 71]));
  doc.roundedRect(W - M - 24, 19, 24, 6, 3, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...(closed ? [5, 38, 26] : [58, 36, 0]));
  doc.text(closed ? 'CLOSED' : 'LOADING', W - M - 12, 23.2, { align: 'center' });

  // details cards: two rows of four
  const meta = [
    ['Vehicle no.', prettyVehicle(d.vehicleNo)], ['Transport', d.transport], ['Location', d.location], ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(', ') || '-'],
    ['Loaded by', `${d.empName} (${d.empNo})`], ['Login time', fmt.dt(d.loginAt)], ['Started', fmt.dt(d.createdAt)], ['Closed', closed ? fmt.dt(d.closedAt) : 'Still loading']
  ];
  const cw = (W - 2 * M - 3 * 2.5) / 4;
  meta.forEach(([k, v], i) => {
    const x = M + (i % 4) * (cw + 2.5), y = 41 + Math.floor(i / 4) * 15;
    doc.setFillColor(...tint); doc.roundedRect(x, y, cw, 12.5, 1.5, 1.5, 'F');
    doc.setFillColor(...blue); doc.rect(x, y, 1, 12.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...mute); doc.text(k, x + 3.5, y + 4.5);
    doc.setFontSize(9); doc.setTextColor(...ink); doc.text(doc.splitTextToSize(String(v || '-'), cw - 5)[0], x + 3.5, y + 9.5);
  });

  // summary strip: driver photo | total boxes | total weight | weight check
  const y0 = 73, sh = 34;
  const pw = 30;
  doc.setFillColor(...tint); doc.roundedRect(M, y0, pw, sh, 2, 2, 'F');
  if (d.driverPhoto) { try { doc.addImage(d.driverPhoto, 'JPEG', M + 1, y0 + 1, pw - 2, sh - 8); } catch { /* bad image */ } }
  else { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...mute); doc.text('No photo', M + pw / 2, y0 + 14, { align: 'center' }); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...mute); doc.text('Driver photo', M + pw / 2, y0 + sh - 2.2, { align: 'center' });
  const boxW = (W - 2 * M - pw - 3 * 3) / 3;
  const card = (i, label, val, sub, dark) => {
    const x = M + pw + 3 + i * (boxW + 3);
    doc.setFillColor(...(dark ? navy : tint)); doc.roundedRect(x, y0, boxW, sh, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...(dark ? [169, 216, 242] : mute)); doc.text(label, x + 5, y0 + 8);
    doc.setFontSize(22); doc.setTextColor(...(dark ? [255, 255, 255] : ink)); doc.text(val, x + 5, y0 + 21);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(dark ? [169, 216, 242] : mute)); doc.text(doc.splitTextToSize(sub, boxW - 9).slice(0, 2), x + 5, y0 + 27);
  };
  const withW = d.boxes.filter(b => b.weight != null).length;
  card(0, 'TOTAL BOXES', String(d.boxes.length), `${withW} of ${d.boxes.length} with weight on label`, true);
  card(1, 'TOTAL WEIGHT', kg(d.totalWeight) + ' kg', d.weightEntered != null ? 'Weighbridge weight' : 'Added up from box labels', true);
  card(2, 'LABEL WEIGHT', kg(d.labelWeight) + ' kg', d.weightEntered != null ? `Differs by ${kg(Math.abs(d.weightEntered - d.labelWeight))} kg` : 'Matches the total', false);

  // box table
  const body = d.boxes.map(b => [b.seq, b.boxNo || b.raw, b.item || '', b.qty ?? '', b.weight != null ? kg(b.weight) : '-', b.uid || '', fmt.time(b.scannedAt)]);
  doc.autoTable({
    startY: y0 + sh + 6, margin: { left: M, right: M, bottom: 16 },
    head: [['#', 'Box no.', 'Item', 'Qty', 'Weight (kg)', 'Unique ID', 'Time']],
    body: body.length ? body : [[{ content: 'No boxes scanned', colSpan: 7, styles: { halign: 'center', textColor: mute } }]],
    foot: [[{ content: `${d.boxes.length} boxes`, colSpan: 3, styles: { halign: 'left' } }, String(d.boxes.reduce((s, b) => s + (Number(b.qty) || 0), 0) || ''), kg(d.labelWeight), { content: '', colSpan: 2 }]],
    showFoot: 'lastPage',
    theme: 'grid', styles: { fontSize: 8.5, cellPadding: { top: 2.1, bottom: 2.1, left: 2.2, right: 2.2 }, textColor: ink, lineColor: [214, 228, 239], lineWidth: 0.2, valign: 'middle', overflow: 'ellipsize' },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold', lineColor: navy },
    footStyles: { fillColor: [222, 239, 250], textColor: navy, fontStyle: 'bold', fontSize: 9, lineColor: [214, 228, 239] },
    alternateRowStyles: { fillColor: [245, 250, 254] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', textColor: blue, fontStyle: 'bold' },
      1: { cellWidth: 34, font: 'courier', fontStyle: 'bold' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 11, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 40, font: 'courier', fontSize: 7.5 },
      6: { cellWidth: 15, halign: 'right', textColor: mute }
    },
    didParseCell: c => { if (c.section === 'foot' && c.column.index === 4) c.cell.styles.halign = 'right'; if (c.section === 'head' && [3, 4, 6].includes(c.column.index)) c.cell.styles.halign = 'right'; }
  });

  let sy = doc.lastAutoTable.finalY + 22;
  if (sy > 278) { doc.addPage(); sy = 40; }
  [['Loaded by', M], ['Driver', M + 64], ['Security', M + 128]].forEach(([t, x]) => {
    doc.setDrawColor(...navy); doc.setLineWidth(0.4); doc.line(x, sy, x + 54, sy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...mute); doc.text(t, x, sy + 4.5);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...blue); doc.rect(0, 293, W, 4, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...mute);
    doc.text(`${settings.company}  |  Generated ${fmt.dt(Date.now())}`, M, 290);
    doc.text(`Page ${i} of ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc.output('blob');
}

// Box numbers only: header, list code, date, count, and a neat 3-column grid.
async function toPDFLimited(d, settings) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 12;
  const blue = [4, 159, 224], navy = [11, 33, 64], ink = [19, 32, 47], mute = [60, 108, 140], tint = [234, 246, 253];
  doc.setFillColor(...navy); doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(...blue); doc.rect(0, 30, W, 1.2, 'F');
  try { doc.addImage(await logoPNG(), 'PNG', M, 9, 33, 9); } catch { /* logo optional */ }
  doc.setTextColor(191, 230, 250); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('INDIA LIMITED', M, 23);
  doc.setTextColor(255); doc.setFontSize(14); doc.text('Box list', 56, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(191, 230, 250); doc.text(settings.company, 56, 21);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255); doc.text(d.code, W - M, 15, { align: 'right' });
  const cards = [['List', d.code], ['Date', fmt.dt(d.createdAt)], ['Total boxes', String(d.boxes.length)]];
  const cw = (W - 2 * M - 2 * 3) / 3;
  cards.forEach(([k, v], i) => {
    const x = M + i * (cw + 3), dark = i === 2;
    doc.setFillColor(...(dark ? navy : tint)); doc.roundedRect(x, 38, cw, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...(dark ? [169, 216, 242] : mute)); doc.text(k.toUpperCase(), x + 4, 44);
    doc.setFontSize(dark ? 14 : 10.5); doc.setTextColor(...(dark ? [255, 255, 255] : ink)); doc.text(v, x + 4, 50.5);
  });
  const per = 3, rows = [];
  for (let i = 0; i < d.boxes.length; i += per) rows.push(d.boxes.slice(i, i + per).flatMap(b => [b.seq, b.boxNo]).concat(Array((per - Math.min(per, d.boxes.length - i)) * 2).fill('')));
  const cols = {};
  for (let c = 0; c < per; c++) { cols[c * 2] = { cellWidth: 11, halign: 'center', textColor: blue, fontStyle: 'bold' }; cols[c * 2 + 1] = { font: 'courier', fontStyle: 'bold' }; }
  doc.autoTable({
    startY: 61, margin: { left: M, right: M, bottom: 16 },
    head: [Array.from({ length: per }, () => ['#', 'Box no.']).flat()],
    body: rows.length ? rows : [[{ content: 'No boxes scanned', colSpan: per * 2, styles: { halign: 'center', textColor: mute } }]],
    theme: 'grid', styles: { fontSize: 9.5, cellPadding: 2.4, textColor: ink, lineColor: [214, 228, 239], lineWidth: 0.2 },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [245, 250, 254] }, columnStyles: cols
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...mute);
    doc.text(`${settings.company} | Box list ${d.code}`, M, 290); doc.text(`Page ${i} of ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc.output('blob');
}

export async function downloadPDF(d, s) { download(await toPDF(d, s), fileBase(d) + '.pdf'); }

// ---------- Share ----------
export async function share(d, s, kind = 'pdf') {
  const blob = kind === 'xlsx' ? toExcel(d, s) : await toPDF(d, s);
  const file = new File([blob], fileBase(d) + (kind === 'xlsx' ? '.xlsx' : '.pdf'), { type: blob.type || 'application/pdf' });
  const text = d.limited ? `${s.company} — Box list\n${d.code} · ${d.boxes.length} boxes` : `${s.company} — ${s.docTitle}\n${d.code}\nVehicle ${prettyVehicle(d.vehicleNo)} · ${d.transport}\n${d.boxes.length} boxes · ${fmt.kg(d.totalWeight)}\nBy ${d.empName} (${d.empNo}), ${fmt.dt(d.closedAt || d.createdAt)}`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: d.code, text });
    return 'shared';
  }
  // Desktop fallback: download the file and open WhatsApp with the summary.
  download(blob, file.name);
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  return 'fallback';
}

// ---------- POL sheet (preview + print) ----------
export function sheetHTML(d, s) {
  d = totals({ ...d, boxes: [...d.boxes] });
  const cols = 6, min = 60;
  const n = Math.max(min, Math.ceil(d.boxes.length / cols) * cols);
  const cells = Array.from({ length: n }, (_, i) => d.boxes[i]);
  const closed = d.status === 'closed';
  const L = d.limited;
  return `<div class="ps">
    <header class="ps-band">
      <div class="lock"><img src="assets/yuken-logo-white.svg" alt="Yuken"><span>INDIA LIMITED</span></div>
      <div class="ttl"><b>${L ? 'Box list' : esc(s.docTitle)}</b><span>${esc(s.company)}${s.plant ? ' &nbsp;|&nbsp; ' + esc(s.plant) : ''}</span></div>
      <div class="cd"><b>${esc(d.code)}</b><span class="${closed ? '' : 'open'}">${closed ? 'Closed' : 'Loading'}</span></div>
    </header>
    <div class="ps-body">
      ${L ? `<div class="ps-meta"><div><span>List</span><b>${esc(d.code)}</b></div><div><span>Date</span><b>${fmt.dt(d.createdAt)}</b></div><div><span>Total boxes</span><b>${d.boxes.length}</b></div></div>` : `<div class="ps-meta">
        <div><span>Employee</span><b>${esc(d.empName)}</b></div>
        <div><span>Employee no.</span><b>${esc(d.empNo)}</b></div>
        <div><span>Login time</span><b>${fmt.dt(d.loginAt)}</b></div>
        <div><span>Vehicle no.</span><b>${esc(prettyVehicle(d.vehicleNo))}</b></div>
        <div><span>Transport</span><b>${esc(d.transport)}</b></div>
        <div><span>Started</span><b>${fmt.dt(d.createdAt)}</b></div>
        <div><span>Location</span><b>${esc(d.location)}</b></div>
        <div><span>Driver</span><b>${esc([d.driverName, d.driverPhone].filter(Boolean).join(', ') || '—')}</b></div>
      </div>`}
      <div class="ps-h"><b>Master boxes loaded</b><span>Scanned ${fmt.dt(d.boxes[0]?.scannedAt)} to ${fmt.time(d.boxes.at(-1)?.scannedAt)}</span></div>
      <div class="ps-grid">${cells.map((b, i) => `<div class="${b ? '' : 'blank'} ${Math.floor(i / cols) % 2 ? 'alt' : ''}"><i>${i + 1}</i>${b ? `<span>${esc(b.boxNo || b.raw)}</span>${b.weight != null ? `<em>${kg(b.weight)}</em>` : ''}` : ''}</div>`).join('')}</div>
      ${L ? '' : `<div class="ps-foot">
        <div class="ps-tot"><span>Total boxes</span><b>${d.boxes.length}</b></div>
        <div class="ps-tot"><span>Total weight${d.weightEntered != null ? ' (weighbridge)' : ''}</span><b>${kg(d.totalWeight)} kg</b>${d.weightEntered != null ? `<small>Labels: ${kg(d.labelWeight)} kg</small>` : ''}</div>
        <div class="ps-photo">${d.driverPhoto ? `<img src="${d.driverPhoto}" alt="">` : '<em>No driver photo</em>'}<span>Driver photo</span></div>
      </div>
      `}<div class="ps-sign"><div>Loaded by</div><div>Driver</div><div>Security</div></div>
    </div>
    <footer class="ps-gen"><span>${esc(s.company)} &nbsp;|&nbsp; ${esc(s.docTitle)}</span><span>Generated ${fmt.dt(Date.now())}</span></footer>
  </div>`;
}

export function printSheet(d, s) {
  const root = document.getElementById('print-root');
  root.innerHTML = sheetHTML(d, s);
  const imgs = [...root.querySelectorAll('img')];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 60));
}
