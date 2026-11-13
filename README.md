# Yuken: FG Proof of Loading

A web app for the finished-goods dispatch dock. Employees use their phones to scan master-box labels into a loading list for each vehicle. The admin adds employees, watches lists fill up live, and exports reports.

**Live:** https://pankqx.github.io/yuken/

## What it does

- **Strict accounts.** Only the admin can add employees. Each record holds name, DOB (must be 18+), mobile, address, PIN code, optional Aadhaar (checked with the Verhoeff checksum and shown masked), employee no., designation, joining date and an emergency contact. It also records who created the account, when, and from what device. New accounts get a temporary password that must be changed at first sign-in. Disabled accounts are locked out right away.
- **Header before scanning.** Vehicle no. (Indian plate format), transport (drop-down, or type a name), serial key (type it or scan it), location, driver name and mobile, and the driver photo. Scanning stays locked until all of these are filled in.
- **Scanning.** Uses the phone camera (QR, Code 128/39/93, EAN, ITF, Data Matrix, PDF417) or a USB/Bluetooth barcode gun, including multi-line QR codes. Scans are queued, so none are lost when the gun is fast.
- **Label parsing.** Reads bare box numbers (`4270036177-3`), `Key: value` labels, single-line labels and JSON. It pulls out the box no., weight, date packed, customer, ship-to, transporter, item, qty and unique ID.
- **Duplicate blocking across phones.** A box already on the list shows "Already scanned". A box already loaded on another vehicle is blocked too. Each box is saved in a transaction, so two phones can't load the same box.
- **Output.** Excel, PDF, an A4 print sheet in the POL layout, and Share (uses the phone's share sheet; on desktop it opens WhatsApp).
- **Admin panel.** A live overview, all lists with filters (search also finds box numbers), an Excel report, employees, an activity log, and settings for the print header, transporters, locations and rules.
- **Installable on phones.** Add it to the home screen. The app shell works offline.

## Setting up Firebase (one time, free plan)

1. Go to https://console.firebase.google.com → **Create a project** (for example `yuken-pol`). Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database.** Pick the location `asia-south1 (Mumbai)` and start in **production mode**.
4. **Firestore → Rules:** paste in the contents of [`firestore.rules`](firestore.rules), then click **Publish**.
5. **Project settings (gear icon) → Your apps → Web (`</>`)** → register the app → copy the `firebaseConfig` object.
6. Paste it into [`js/config.js`](js/config.js) in place of `null`, then commit.
7. **Authentication → Settings → Authorized domains → Add domain** `pankqx.github.io`.
8. Open the site. The first visit asks you to create the admin account.

The values in `firebaseConfig` are not secrets. The security rules decide who can read or write what.

Until `js/config.js` is filled in, the app runs in **on-device mode**: everything is saved in that one browser. This is useful for demos.

## Deploying

Every push to `main` deploys through GitHub Actions (`.github/workflows/pages.yml`). This needs a one-time setting: **Repo → Settings → Pages → Source: GitHub Actions**.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

**Settings → Load demo data** adds three sample employees (`babu`, `ravi`, `imran`, all with the password `yuken2026`) and ten sample lists.

## How it's built

Plain HTML, CSS and JavaScript modules, with no build step.

```
index.html               app shell
css/app.css              design system + A4 print sheet
js/app.js                router and every screen
js/store.js              picks the cloud or on-device store
js/store-firebase.js     Firebase Auth + Firestore
js/store-local.js        IndexedDB (on-device mode)
js/common.js             shared rules: duplicates, totals, list numbers
js/parse.js              label parser
js/export.js             Excel / PDF / print / share
js/camera.js             camera scanning
js/ui.js, util.js        UI kit, icons, validation
firestore.rules          database security rules
vendor/                  Firebase, SheetJS, jsPDF, html5-qrcode (bundled so the dock works on weak Wi-Fi)
```

### Accounts and password resets

Employees sign in with a username or employee no. Behind the scenes, each one has a Firebase Auth account with an internal address (`name.1@yukenpol.app`); nothing is ever emailed to it. The browser can't change another person's password, so **Reset password** issues a fresh sign-in account and retires the old one. The rules only accept accounts listed in `members/`, so the old password stops working immediately.
