// Excel, PDF, print and share for dispatch lists.
import { fmt, esc, download, prettyVehicle } from './util.js';

const fileBase = d => `${d.code}_${prettyVehicle(d.vehicleNo).replace(/\s/g, '')}`;

const boxRow = (b, d) => ({
  '#': b.seq,
  'Box no.': b.boxNo || '',
  'Unique ID': b.uid || '',
  'Item': b.item || '',
  'Qty': b.qty ?? '',
  'Weight (kg)': b.weight ?? '',
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
  const head = [
    [settings.company],
    [settings.docTitle],
    [],
    ['List', d.code, '', 'Status', d.status === 'closed' ? 'Closed' : 'Open'],
    ['Employee', `${d.empName} (${d.empNo})`, '', 'Login time', fmt.dt(d.loginAt)],
    ['Vehicle no.', prettyVehicle(d.vehicleNo), '', 'Transport', d.transport],
    ['Serial key', d.serialKey, '', 'Location', d.location],
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
    'Vehicle': prettyVehicle(d.vehicleNo), 'Transport': d.transport, 'Serial key': d.serialKey, 'Location': d.location,
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

export async function toPDF(d, settings) {
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

  // details cards
  const meta = [
    ['Employee', `${d.empName} (${d.empNo})`], ['Login time', fmt.dt(d.loginAt)], ['Vehicle no.', prettyVehicle(d.vehicleNo)], ['Transport', d.transport],
    ['Serial key', d.serialKey], ['Location', d.location], ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(', ') || '-'], ['Closed', closed ? fmt.dt(d.closedAt) : 'Open']
  ];
  const cw = (W - 2 * M - 3 * 2.5) / 4;
  meta.forEach(([k, v], i) => {
    const x = M + (i % 4) * (cw + 2.5), y = 41 + Math.floor(i / 4) * 15;
    doc.setFillColor(...tint); doc.roundedRect(x, y, cw, 12.5, 1.5, 1.5, 'F');
    doc.setFillColor(...blue); doc.rect(x, y, 1, 12.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...mute); doc.text(k, x + 3.5, y + 4.5);
    doc.setFontSize(9); doc.setTextColor(...ink); doc.text(doc.splitTextToSize(String(v || '-'), cw - 5)[0], x + 3.5, y + 9.5);
  });

  const hasDetail = d.boxes.some(b => b.item || b.weight != null);
  const body = d.boxes.map(b => hasDetail
    ? [b.seq, b.boxNo || '', b.item || '', b.qty ?? '', b.weight ?? '', b.uid || '', fmt.time(b.scannedAt)]
    : [b.seq, b.boxNo || b.raw, fmt.time(b.scannedAt)]);
  doc.autoTable({
    startY: 75, margin: { left: M, right: M },
    head: [hasDetail ? ['#', 'Box no.', 'Item', 'Qty', 'Kg', 'Unique ID', 'Time'] : ['#', 'Box no.', 'Time']],
    body: body.length ? body : [[{ content: 'No boxes scanned', colSpan: hasDetail ? 7 : 3, styles: { halign: 'center', textColor: mute } }]],
    theme: 'plain', styles: { fontSize: 8.5, cellPadding: 2, textColor: ink, lineColor: [220, 232, 241], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 250, 254] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center', textColor: blue, fontStyle: 'bold' }, 1: { font: 'courier', fontStyle: 'bold' } }
  });

  let y = doc.lastAutoTable.finalY + 8;
  if (y > 232) { doc.addPage(); y = 20; }
  const tot = (x, label, val) => {
    doc.setFillColor(...navy); doc.roundedRect(x, y, 56, 22, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(169, 216, 242); doc.text(label, x + 5, y + 7);
    doc.setFontSize(19); doc.setTextColor(255); doc.text(val, x + 5, y + 17);
  };
  tot(M, 'Total boxes', String(d.boxes.length));
  tot(M + 60, 'Total weight', fmt.kg(d.totalWeight));
  if (d.driverPhoto) {
    try { doc.addImage(d.driverPhoto, 'JPEG', W - M - 46, y, 46, 32); } catch { /* bad image */ }
    doc.setFontSize(7.5); doc.setTextColor(...mute); doc.text('Driver photo', W - M - 46, y + 36);
  }
  const sy = y + 50;
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

export async function downloadPDF(d, s) { download(await toPDF(d, s), fileBase(d) + '.pdf'); }

// ---------- Share ----------
export async function share(d, s, kind = 'pdf') {
  const blob = kind === 'xlsx' ? toExcel(d, s) : await toPDF(d, s);
  const file = new File([blob], fileBase(d) + (kind === 'xlsx' ? '.xlsx' : '.pdf'), { type: blob.type || 'application/pdf' });
  const text = `${s.company} — ${s.docTitle}\n${d.code}\nVehicle ${prettyVehicle(d.vehicleNo)} · ${d.transport}\n${d.boxes.length} boxes · ${fmt.kg(d.totalWeight)}\nBy ${d.empName} (${d.empNo}), ${fmt.dt(d.closedAt || d.createdAt)}`;
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
  const cols = 6, min = 60;
  const n = Math.max(min, Math.ceil(d.boxes.length / cols) * cols);
  const cells = Array.from({ length: n }, (_, i) => d.boxes[i]);
  const closed = d.status === 'closed';
  return `<div class="ps">
    <header class="ps-band">
      <div class="lock"><img src="assets/yuken-logo-white.svg" alt="Yuken"><span>INDIA LIMITED</span></div>
      <div class="ttl"><b>${esc(s.docTitle)}</b><span>${esc(s.company)}${s.plant ? ' &nbsp;|&nbsp; ' + esc(s.plant) : ''}</span></div>
      <div class="cd"><b>${esc(d.code)}</b><span class="${closed ? '' : 'open'}">${closed ? 'Closed' : 'Loading'}</span></div>
    </header>
    <div class="ps-body">
      <div class="ps-meta">
        <div><span>Employee</span><b>${esc(d.empName)}</b></div>
        <div><span>Employee no.</span><b>${esc(d.empNo)}</b></div>
        <div><span>Login time</span><b>${fmt.dt(d.loginAt)}</b></div>
        <div><span>Vehicle no.</span><b>${esc(prettyVehicle(d.vehicleNo))}</b></div>
        <div><span>Transport</span><b>${esc(d.transport)}</b></div>
        <div><span>Serial key</span><b>${esc(d.serialKey)}</b></div>
        <div><span>Location</span><b>${esc(d.location)}</b></div>
        <div><span>Driver</span><b>${esc([d.driverName, d.driverPhone].filter(Boolean).join(', ') || '—')}</b></div>
      </div>
      <div class="ps-h"><b>Master boxes loaded</b><span>Scanned ${fmt.dt(d.boxes[0]?.scannedAt)} to ${fmt.time(d.boxes.at(-1)?.scannedAt)}</span></div>
      <div class="ps-grid">${cells.map((b, i) => `<div class="${b ? '' : 'blank'} ${Math.floor(i / cols) % 2 ? 'alt' : ''}"><i>${i + 1}</i>${b ? esc(b.boxNo || b.raw) : ''}</div>`).join('')}</div>
      <div class="ps-foot">
        <div class="ps-tot"><span>Total boxes</span><b>${d.boxes.length}</b></div>
        <div class="ps-tot"><span>Total weight</span><b>${fmt.kg(d.totalWeight)}</b></div>
        <div class="ps-photo">${d.driverPhoto ? `<img src="${d.driverPhoto}" alt="">` : '<em>No driver photo</em>'}<span>Driver photo</span></div>
      </div>
      <div class="ps-sign"><div>Loaded by</div><div>Driver</div><div>Security</div></div>
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
