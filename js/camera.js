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

// opts.allCodes: also read plain barcodes. Off by default: a Yuken label has a
// plain barcode (box number only) next to the QR code that holds the weight
// and description, and the camera must read the QR code.
export async function startCamera(elId, opts, onCode) {
  if (typeof opts === 'function') { onCode = opts; opts = {}; }
  let formats;
  await loadScript('vendor/html5-qrcode.min.js');
  const F = window.Html5QrcodeSupportedFormats;
  const cam = new window.Html5Qrcode(elId, {
    verbose: false,
    formatsToSupport: formats = opts.allCodes ? [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.ITF, F.DATA_MATRIX, F.PDF_417] : [F.QR_CODE, F.DATA_MATRIX, F.PDF_417],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  let last = '', lastAt = 0;
  await cam.start(
    { facingMode: 'environment' },
    { fps: 15, aspectRatio: 4 / 3, disableFlip: true }, // no qrbox: the whole picture is searched, like a barcode gun
    text => {
      // A label stays in view for a while. Ignore the same code until a
      // different one is read, or until it has been out of sight for 8 s.
      const now = Date.now();
      if (text === last && now - lastAt < 8000) { lastAt = now; return; }
      last = text; lastAt = now;
      onCode(text);
    },
    () => {}
  );
  return {
    async stop() { try { await cam.stop(); cam.clear(); } catch { /* already stopped */ } },
    // Manual capture: read the current picture harder (full size, then zoomed
    // into the middle). For when the label is small, angled or badly lit.
    async capture() {
      const v = document.querySelector(`#${elId} video`);
      if (!v?.videoWidth) return null;
      const shot = (zoom) => {
        const c = document.createElement('canvas');
        const sw = v.videoWidth / zoom, sh = v.videoHeight / zoom;
        c.width = Math.min(1600, sw * zoom); c.height = c.width * sh / sw;
        c.getContext('2d').drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
        return c;
      };
      for (const zoom of [1, 1.6, 2.4]) {
        const c = shot(zoom);
        if ('BarcodeDetector' in window) {
          try { const r = await new window.BarcodeDetector(opts.allCodes ? undefined : { formats: ['qr_code', 'data_matrix', 'pdf417'] }).detect(c); if (r[0]?.rawValue) return r[0].rawValue; } catch { /* try the other reader */ }
        }
        try {
          let host = document.getElementById('cap-reader');
          if (!host) { host = document.createElement('div'); host.id = 'cap-reader'; host.hidden = true; document.body.append(host); }
          const blob = await new Promise(r => c.toBlob(r, 'image/png'));
          const text = await new window.Html5Qrcode('cap-reader', { verbose: false, formatsToSupport: formats }).scanFile(new File([blob], 'shot.png', { type: 'image/png' }), false);
          if (text) return text;
        } catch { /* nothing found at this zoom */ }
      }
      return null;
    }
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

// Driver photo: opens the camera straight away (no file picker). Resolves
// with a JPEG data URL, or null if cancelled. Falls back to the phone's own
// camera app if the browser cannot open the camera itself.
export function takePhoto(title = 'Driver photo') {
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'scrim top';
    const el = document.createElement('div'); el.className = 'dialog snap';
    el.innerHTML = `<h2>${title}</h2>
      <div class="snap-view"><video playsinline muted autoplay></video><img alt="" hidden><div class="snap-flash"></div></div>
      <div class="row snap-row">
        <button class="btn ghost" data-c>Cancel</button>
        <button class="btn icon" data-flip title="Switch camera" aria-label="Switch camera">${icon('undo')}</button>
        <button class="btn primary" data-shot>${icon('camera')} Take photo</button>
        <button class="btn" data-retake hidden>${icon('undo')} Retake</button>
        <button class="btn primary" data-use hidden>${icon('check')} Use photo</button>
      </div>`;
    document.body.append(scrim, el);
    const video = el.querySelector('video'), img = el.querySelector('img');
    let stream = null, facing = 'environment', shot = null;
    const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
    const done = v => { stop(); el.remove(); scrim.remove(); resolve(v); };
    const start = async () => {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        video.srcObject = stream; await video.play();
      } catch (err) {
        done(null);
        fallbackPicker().then(resolve);
      }
    };
    const show = (mode) => {
      const live = mode === 'live';
      video.hidden = !live; img.hidden = live;
      el.querySelector('[data-shot]').hidden = !live; el.querySelector('[data-flip]').hidden = !live;
      el.querySelector('[data-retake]').hidden = live; el.querySelector('[data-use]').hidden = live;
    };
    el.querySelector('[data-c]').onclick = () => done(null);
    scrim.onclick = () => done(null);
    el.querySelector('[data-flip]').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); };
    el.querySelector('[data-shot]').onclick = () => {
      const w = video.videoWidth, h = video.videoHeight; if (!w) return;
      const scale = Math.min(1, 900 / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      shot = c.toDataURL('image/jpeg', 0.72);
      img.src = shot; show('still');
      const f = el.querySelector('.snap-flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
    };
    el.querySelector('[data-retake]').onclick = () => { shot = null; show('live'); };
    el.querySelector('[data-use]').onclick = () => done(shot);
    if (!navigator.mediaDevices?.getUserMedia) { done(null); fallbackPicker().then(resolve); return; }
    start();
  });
}

// Last resort: the phone's own camera app via a file input that asks for the camera.
function fallbackPicker() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return resolve(null);
      const { compressImage } = await import('./util.js');
      resolve(await compressImage(file, 900, 0.72));
    };
    input.click();
  });
}
