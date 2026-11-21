# Yuken: FG Proof of Loading

A web app for Yuken India Limited's finished-goods dispatch dock. Employees scan master-box labels into a loading list for each vehicle, then print a POL (Proof of Loading) sheet. The admin adds employees, sees every list, and exports reports.

**Live:** https://pankqx.github.io/yuken/

## What it does

- **Strict accounts.** Only the admin can add employees. Each record holds name, DOB (must be 18+), mobile, address, PIN code, optional Aadhaar (checked with the Verhoeff checksum and shown masked), employee no., designation, joining date and an emergency contact. It also records who created the account, when, and from what device. New accounts get a temporary password that must be changed at first sign-in. Disabled accounts are locked out right away.
- **Header before scanning.** Vehicle no. (Indian plate format), transport (drop-down, or type a name), serial key (type it or scan it), location, driver name and mobile, and the driver photo. Scanning stays locked until all of these are filled in.
- **Scanning.** On the dock computer, a USB barcode gun (including multi-line QR labels). On phones and tablets the camera starts by itself and works like a barcode gun: every label it sees is captured with a beep and a green flash, and the same label is not re-read while it stays in view. Scans are queued, so none are lost.
- **Driver photo.** Opens the camera inside the app (back camera, with a switch button), then Take photo → Use photo.
- **Label parsing.** Reads bare box numbers (`4270036177-3`), `Key: value` labels, single-line labels and JSON. It pulls out the box no., weight, date packed, customer, ship-to, transporter, item, qty and unique ID.
- **Duplicate blocking.** A box already on the list shows "Already scanned" and its tile flashes. A box already loaded on another vehicle is blocked too.
- **POL sheet.** A designed A4 sheet in Yuken colours, with a full-screen preview, then Print, PDF, Excel or Share.
- **Admin panel.** Overview (today's boxes and weight, what is loading now, a 7-day chart, latest activity), all lists with filters (search also finds box numbers), an Excel report, employees, an activity log, and settings for the print header, transporters, locations, rules and the master PIN.
- **Sign-in scene.** A three.js pallet of cartons, redrawn live as coloured ASCII, with a laser scanning each box.
- **Works offline.** Once loaded, the app keeps working if the dock Wi-Fi drops.

## Who can do what

The first account created on a device is the admin (Chetan). He adds managers and employees from **People → Add person**.

## How it runs at the dock

The app runs on **one computer** at the loading dock, with a USB barcode gun. Employees take turns: each signs in, scans a vehicle's boxes, closes the list, prints the POL sheet and signs out. Everything is saved in that computer's browser (IndexedDB). Use **Settings → Download backup** every week.

### Master PIN

**Forgot password? Reset it with the master PIN** on the sign-in screen resets any account, including the admin. The default PIN is stored only as a salted PBKDF2 hash in `js/config.js`. Change it after the first use in **Settings → Master PIN**; the new PIN is kept on that computer only. Five wrong tries lock it for 10 minutes.

## Deploying

Every push to `main` deploys through GitHub Actions (`.github/workflows/pages.yml`). This needs a one-time setting: **Repo → Settings → Pages → Source: GitHub Actions**.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

**Settings → Load demo data** adds three sample employees (`babu`, `ravi`, `imran`, all with the password `yuken2026`) and ten sample lists.

## How it's built

Plain HTML, CSS and JavaScript modules, with no build step and no server or database to run.

```
index.html               app shell
css/app.css              design system + A4 print sheet
js/app.js                router and every screen
js/store.js              data store entry point
js/store-local.js        accounts, lists, master PIN (IndexedDB)
js/config.js             master PIN hash
js/hero.js               three.js + ASCII sign-in scene
assets/                  Yuken India Limited logo (SVG)
js/common.js             shared rules: duplicates, totals, list numbers
js/parse.js              label parser
js/export.js             Excel / PDF / print / share
js/camera.js             camera scanning
js/ui.js, util.js        UI kit, icons, validation
vendor/                  three.js, SheetJS, jsPDF, html5-qrcode (bundled so the dock works on weak Wi-Fi)
```

## Roles and sign-in

- **Admin (Chetan)**: full control. He signs in with his password, or with Google once it is linked, and stays signed in until he presses Sign out.
- **Managers (Mahesh, Sheela)**: view everything, change nothing. Their sign-in is on the "Manager or admin" tab.
- **Employees**: start lists and scan. They are signed out at the end of a shift.

See **AGENTS.md** for the file map, the pages, how weights work and how to turn on Google sign-in and Google Drive backup.
