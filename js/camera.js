// Camera scanning (QR + 1D barcodes) via html5-qrcode, loaded on demand.
import { icon } from './ui.js';

const loaded = {};
export function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}

export async function startCamera(elId, onCode) {
  await loadScript('vendor/html5-qrcode.min.js');
  const F = window.Html5QrcodeSupportedFormats;
  const cam = new window.Html5Qrcode(elId, {
    verbose: false,
    formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.ITF, F.DATA_MATRIX, F.PDF_417],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  let last = '', lastAt = 0;
  await cam.start(
    { facingMode: 'environment' },
    { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * 0.72), height: Math.floor(h * 0.64) }), aspectRatio: 4 / 3 },
    text => {
      // The same code stays in view for a while — ignore repeats for 2.5 s.
      const now = Date.now();
      if (text === last && now - lastAt < 2500) return;
      last = text; lastAt = now;
      onCode(text);
    },
    () => {}
  );
  return {
    async stop() { try { await cam.stop(); cam.clear(); } catch { /* already stopped */ } }
  };
}

// One-off scan in a dialog (used for the serial key).
export function scanOnce(title = 'Scan code') {
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'scrim top';
    const el = document.createElement('div'); el.className = 'dialog';
    el.innerHTML = `<h2>${title}</h2><p class="mute" style="margin-bottom:14px">Hold the code inside the frame.</p>
      <div class="camera"><div id="once-reader"></div><div class="frame"></div></div>
      <div class="row" style="margin-top:16px"><button class="btn ghost" data-c>Cancel</button></div>`;
    document.body.append(scrim, el);
    let cam;
    const done = async v => { await cam?.stop(); el.remove(); scrim.remove(); resolve(v); };
    el.querySelector('[data-c]').onclick = () => done(null);
    scrim.onclick = () => done(null);
    startCamera('once-reader', code => done(code)).then(c => { cam = c; }).catch(err => {
      el.querySelector('.camera').outerHTML = `<div class="form-err">${icon('alert')} Camera unavailable: ${err?.message || err}. Type the code instead.</div>`;
    });
  });
}
