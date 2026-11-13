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
export function toPDF(d, settings) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  const blue = [23, 71, 166], ink = [27, 31, 36], mute = [110, 118, 130];

  doc.setFillColor(...blue); doc.rect(0, 0, W, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...blue);
  doc.text('YUKEN', M, 16);
  doc.setTextColor(...ink); doc.setFontSize(12);
  doc.text(settings.company, W / 2, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...mute);
  doc.text(settings.docTitle + (settings.plant ? '  ·  ' + settings.plant : ''), W / 2, 19.5, { align: 'center' });
  doc.setFont('courier', 'bold'); doc.setFontSize(10); doc.setTextColor(...ink);
  doc.text(d.code, W - M, 16, { align: 'right' });

  const rows = [
    ['Employee', `${d.empName} (${d.empNo})`, 'Login time', fmt.dt(d.loginAt)],
    ['Vehicle no.', prettyVehicle(d.vehicleNo), 'Transport', d.transport],
    ['Serial key', d.serialKey, 'Location', d.location],
    ['Driver', [d.driverName, d.driverPhone].filter(Boolean).join(', ') || '—', 'Status', d.status === 'closed' ? `Closed ${fmt.dt(d.closedAt)}` : 'Open']
  ];
  doc.autoTable({
    startY: 25, body: rows, theme: 'grid', margin: { left: M, right: M },
    styles: { fontSize: 9, cellPadding: 2.2, lineColor: [210, 214, 220], textColor: ink },
    columnStyles: { 0: { textColor: mute, cellWidth: 26 }, 2: { textColor: mute, cellWidth: 26 }, 1: { fontStyle: 'bold' }, 3: { fontStyle: 'bold' } }
  });

  const hasDetail = d.boxes.some(b => b.item || b.weight != null);
  const body = d.boxes.map(b => hasDetail
    ? [b.seq, b.boxNo || '', b.item || '', b.qty ?? '', b.weight ?? '', b.uid || '', fmt.time(b.scannedAt)]
    : [b.seq, b.boxNo || b.raw, fmt.time(b.scannedAt)]);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 5, margin: { left: M, right: M },
    head: [hasDetail ? ['#', 'Box no.', 'Item', 'Qty', 'Kg', 'Unique ID', 'Time'] : ['#', 'Box no.', 'Time']],
    body: body.length ? body : [[{ content: 'No boxes scanned', colSpan: hasDetail ? 7 : 3, styles: { halign: 'center', textColor: mute } }]],
    theme: 'striped', styles: { fontSize: 8.5, cellPadding: 1.8, textColor: ink },
    headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 246, 249] },
    columnStyles: { 0: { cellWidth: 9, halign: 'right' }, 1: { font: 'courier', fontStyle: 'bold' } }
  });

  let y = doc.lastAutoTable.finalY + 8;
  if (y > 230) { doc.addPage(); y = 20; }
  doc.setDrawColor(...blue); doc.setLineWidth(0.4);
  doc.roundedRect(M, y, 85, 18, 2, 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...mute);
  doc.text('Total boxes', M + 4, y + 6); doc.text('Total weight', M + 46, y + 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...ink);
  doc.text(String(d.boxes.length), M + 4, y + 14); doc.text(fmt.kg(d.totalWeight), M + 46, y + 14);

  if (d.driverPhoto) {
    try { doc.addImage(d.driverPhoto, 'JPEG', W - M - 42, y, 42, 32); } catch { /* bad image */ }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...mute);
    doc.text('Driver photo', W - M - 42, y + 36);
  }
  const sy = Math.max(y + 48, y + 30);
  doc.setDrawColor(180); doc.setLineWidth(0.2);
  [['Loaded by', M], ['Driver', M + 62], ['Security', M + 124]].forEach(([t, x]) => {
    doc.line(x, sy, x + 52, sy); doc.setFontSize(8); doc.setTextColor(...mute); doc.text(t, x, sy + 4);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7); doc.setTextColor(...mute);
    doc.text(`Generated ${fmt.dt(Date.now())}  ·  Page ${i} of ${pages}`, W / 2, 290, { align: 'center' });
  }
  return doc.output('blob');
}

export function downloadPDF(d, s) { download(toPDF(d, s), fileBase(d) + '.pdf'); }

// ---------- Share ----------
export async function share(d, s, kind = 'pdf') {
  const blob = kind === 'xlsx' ? toExcel(d, s) : toPDF(d, s);
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

// ---------- Print ----------
export function printSheet(d, s) {
  const root = document.getElementById('print-root');
  const cols = 8, min = 48;
  const cells = Array.from({ length: Math.max(min, Math.ceil(d.boxes.length / cols) * cols) }, (_, i) => d.boxes[i]);
  root.innerHTML = `
  <div class="ps">
    <header class="ps-head">
      <div class="ps-logo">YUKEN</div>
      <div class="ps-title"><strong>${esc(s.company)}</strong><span>${esc(s.docTitle)}</span></div>
      <div class="ps-code">${esc(d.code)}</div>
    </header>
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
    <div class="ps-grid">${cells.map((b, i) => `<div>${b ? `<i>${i + 1}</i>${esc(b.boxNo || b.raw)}` : ''}</div>`).join('')}</div>
    <div class="ps-foot">
      <div class="ps-tot"><span>Total boxes</span><b>${d.boxes.length}</b></div>
      <div class="ps-tot"><span>Total weight</span><b>${fmt.kg(d.totalWeight)}</b></div>
      <div class="ps-photo">${d.driverPhoto ? `<img src="${d.driverPhoto}" alt="">` : '<em>No driver photo</em>'}<span>Driver photo</span></div>
    </div>
    <div class="ps-sign"><div>Loaded by</div><div>Driver</div><div>Security</div></div>
    <p class="ps-gen">Generated ${fmt.dt(Date.now())}</p>
  </div>`;
  const img = root.querySelector('img');
  const go = () => { window.print(); };
  if (img && !img.complete) img.onload = go; else setTimeout(go, 50);
}
