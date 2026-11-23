# AGENTS.md — how this app is put together

Read this first, whether you are a person or an AI assistant. It tells you where
everything lives and what you must not break.

## What it is

Yuken India Limited, FG dispatch dock: **Proof of Loading (POL)**. People scan
master-box labels into a loading list for each vehicle. Then they close the
list and print, download (PDF or Excel) or share it.

- Plain HTML, CSS and JavaScript (ES modules). **No build step, no npm, no server.**
- **Two modes**, picked in `js/store.js`:
  - **Online (Firebase)** when `FIREBASE.apiKey` in `js/config.js` is filled. One shared database: every phone and laptop with the link sees the same people and lists. Code: `js/store-firebase.js`, `js/fb.js`, rules in `firestore.rules`.
  - **This device only** when it is empty. Data stays in the browser (IndexedDB). Code: `js/store-local.js`.
- It is hosted as static files (GitHub Pages or Vercel).
- Backups go to Google Drive (when Google is turned on) or to a downloaded file.

## Run it

```bash
python3 -m http.server 8765      # in the project folder
# open http://localhost:8765
```
The camera needs `https://` or `localhost`. Use the hosted link on phones.

## Map of the files

| File | What is inside | Change it when… |
|---|---|---|
| `index.html` | Page shell, fonts, boot animation, early theme load | Rarely |
| `css/app.css` | All styling. Dark theme on `:root`, light theme on `[data-theme="light"]`. The print/PDF sheet styles start at `.ps` | Colours, spacing, light mode |
| `js/app.js` | **Every screen.** Router at the top, then one `route(...)` block per page (search for the `// ===` banners) | Changing what a page shows or does |
| `js/store-local.js` | All data: users, sessions, lists, boxes, activity, backups, master PIN | Changing how data is saved or who may do what |
| `js/store.js` | Picks the data store: Firebase if configured, else this device | Rarely |
| `js/store-firebase.js` | Online data store (Firebase Auth + Firestore). Same functions as `store-local.js` | Changing online data or sign-in |
| `js/fb.js` | Connects to Firebase (`?emu=1` uses local test servers) | Rarely |
| `firestore.rules` | Who may read and write what online. Paste into Firebase console → Firestore → Rules | Changing permissions |
| `vendor/firebase.js` | Firebase SDK bundle (esbuild of firebase@11, only the functions used) | Upgrading Firebase |
| `js/common.js` | Shared rules: totals (box count and weight), duplicate check, list codes, demo data, default settings | Totals or default settings |
| `js/parse.js` | Turns a scanned label into fields (`parseScan`, `parseWeight`) | A new label format, or weights reading wrong |
| `js/camera.js` | Camera scanning (html5-qrcode), driver photo, script loader | Camera behaviour |
| `js/google.js` | Google sign-in and Google Drive backup/restore | Google features |
| `js/export.js` | Excel, PDF (jsPDF + autotable), print sheet HTML, share | Anything about printouts |
| `js/ui.js` | Icons, toast, drawer, dialogs, form fields | New icon or shared widget |
| `js/util.js` | Formatting (dates, kg), validation, hashing, beep | Helpers |
| `js/config.js` | Master PIN hash, `GOOGLE_CLIENT_ID` | Turning on Google |
| `js/hero.js` | The three.js ASCII art on the sign-in screen | Never needed |
| `vendor/` | Third-party libraries, copied in. Do not edit | — |
| `sw.js` | Offline cache. **Bump `CACHE` (e.g. `yuken-pol-v5`) on every release** or phones keep the old version | Every release |
| `vercel.json` | Headers for Vercel hosting | Rarely |

## Pages (hash routes in `js/app.js`)

| Route | Page | Who |
|---|---|---|
| `#/login` | Staff sign-in: an Employee tab plus one tab per manager (`managersForLogin`). A manager the admin created picks their own password on their tab (`firstPassword`). No admin option here | Employees, managers |
| `#/control` | Admin sign-in ("Control room"). Open it by holding the Yuken logo on the sign-in screen for 2 seconds, or by typing the address. Only the `super` account gets in | The admin |
| `#/home` | Employee home: my open and closed lists | Employees |
| `#/new` | New list: vehicle, transport, location, driver, driver photo | Admin, employees |
| `#/scan/:id` | Scanning screen (barcode gun or camera) | Admin, list owner |
| `#/list/:id` | One list: boxes, totals, preview, print, PDF, Excel, share | Everyone who can see it |
| `#/admin` | Dashboard | Admin, managers |
| `#/admin/lists` | All lists with search and filters (`?open` = loading now) | Admin, managers |
| `#/admin/people` | People (`?add` opens the add form) | Admin edits, managers view |
| `#/admin/activity` | Activity log with filters | Admin edits, managers view |
| `#/admin/data` | Database viewer: every table (lists, boxes, people, activity, settings), searchable, download all as Excel. Read-only; password hashes are never shown | Admin only |
| `#/admin/settings` | Printout header, rules, transporters, locations, master PIN, backups | Admin only |

The account panel (password, light/dark, Google link, sign out) opens from the
avatar on every page. Its code is in `accountDrawer()` in `js/app.js`.

## Roles

| Role (`user.role`) | Who | Can |
|---|---|---|
| `super` | **The admin**, shown as "Admin" | Everything. Add or change people, edit or delete activity entries, fix weights, remove boxes, reopen or delete lists, settings, backups, master PIN |
| `manager` | Managers | **Look only.** Dashboard, all lists, people (read-only), activity, exports |
| `employee` | Loaders and other workers | Start lists, scan, fix their own open list, export their lists |

- Helpers: `isAdmin(u)` = can see everything (super or manager). `isSuper(u)` = can change everything.
- Every sign-in and sign-out is written to Activity for everyone.
- The admin and managers stay signed in until they press Sign out. Employees are signed out after a 14-hour shift (`SHIFT_MS` in `common.js`).
- Older data with role `admin` is changed on load: the first admin becomes `super` and the rest become `manager` (`migrate()` in `store-local.js`).

## Online version (Firebase)

- **Accounts:** only the admin creates them (People → Add person). There is no password to hand out: the person signs in with their username (managers tap their tile) and **chooses their own password the first time**, on any phone or computer.
- How it works: `logins/{username}` (public: name, role, hidden sign-in email `username.N@yuken-pol.app`), `members/{authUid}` (links a sign-in to a username and role), `people/{username}` (full profile). A person can link themselves only once, with the role the admin gave them (enforced in `firestore.rules`).
- **Reset password:** Admin → People → person → Reset password. Their sign-in moves to a new hidden email (N+1) and they choose a new password next time.
- **Admin:** the admin signs in on the Control room with **Google (an admin Gmail listed in `ADMIN.emails` in `js/config.js` and in `isSuper()` in `firestore.rules`)**. After that they can set an admin password in My account and use either. Only that verified Gmail is admin (`isSuper()` in the rules).
- **Offline:** scanning keeps working without internet; boxes are saved on the phone and sent when it reconnects (`bg()` in `store-firebase.js`). Signing in for the first time on a device needs internet.
- Master PIN, Start fresh and demo data are single-computer features and are hidden online.
- **Adding another admin Gmail:** add it to `ADMIN.emails` in `js/config.js` AND to the list in `isSuper()` in `firestore.rules`, then publish the rules in the Firebase console. All admin Gmails share the one Admin account; Activity records which Gmail did it (`account` field).
- **Deleting an account:** People → person → trash icon (admin only). Removes `people`, `logins` and `members` docs; their lists and activity stay.
- The admin account always shows the generic name "Admin" (`ADMIN.name`). Never put a person's name in it.

## The one admin

- There is no setup screen. The admin account is built in: `ADMIN` in `js/config.js` holds its name, admin Gmails and a salted hash of the admin password.
- Signing in on the Control room (`#/control`) with that password, or with Google as `ADMIN.email`, creates the admin account on that device (`ensureAdmin`, id `u-admin`) if it is missing.
- Nobody can create another admin: `saveUser` refuses role `super`, and `migrate()` turns any other old admin into a disabled manager.
- The admin changes the admin password in the account panel (kept on that device as `settings.adminpw`). The master PIN resets it: Control room → Forgot password.
- Never write the admin password itself in this repo.

## Start fresh

Control room → **Start fresh on this device** (or Settings → Erase everything): master PIN + type ERASE.
Deletes every account, list and setting on that device (`eraseAll` in `store-local.js`) and returns to the sign-in screen. The built-in admin is recreated the next time the admin signs in.

## Master PIN

This is the emergency key for when someone forgets their password, including the admin. On the sign-in screen, tap
"Forgot password? Reset it with the master PIN" and enter the username, the master PIN and a new password.
Only a salted hash is stored (`js/config.js`). Never write the PIN itself in this repo, because the repo is public. The admin changes it in Settings → Master PIN. Five wrong tries
lock it for 10 minutes. It cannot be used for anything else.

## Full details vs box numbers only

`canSeeDetails(u)` in `js/app.js`: the admin always; managers by default; employees only when the admin ticks
**Full details in previews, PDFs and Excel** on their People page. Without it, `X.limitView(d)` is used
for preview, print, PDF, Excel and share. That copy has only the list code, date, count and box numbers.

## Weights

- `parseWeight()` in `parse.js` reads `28.7`, `28.7 kg`, `28,7`, `1,234.5`, `28700 g`.
- `totals()` in `common.js` sets `labelWeight` (the sum of the box labels) and `totalWeight`. `totalWeight` is the weighbridge number if one was typed at closing, otherwise `labelWeight`.
- A box with no weight on its label can have one typed in. Tap the box, then "Save weight". `weightBy` records who typed it.
- Multi-line labels from a barcode gun: lines that arrive within 350 ms are joined into one box (scan screen, `commit`).

## Turn on Google (free, about 10 minutes)

1. Go to https://console.cloud.google.com, create a project called `yuken-pol`.
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: choose External, app name "Yuken POL", and add the admin Gmail as a test user. You can publish it later.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorised JavaScript origins**, add the hosted address (for example `https://pankqx.github.io` or `https://chetan-app.vercel.app`) and `http://localhost:8765`.
5. Copy the client ID into `GOOGLE_CLIENT_ID` in `js/config.js`. Bump `sw.js` CACHE, commit and push.
6. In the app, the admin opens the avatar and taps **Link my Google account**. From then on, **Sign in with Google** works, and Settings → **Back up to Google Drive** saves to a "Yuken POL backups" folder.

The app only asks for `drive.file`, so it can see only the files it made itself.

## Rules for changes

- **Commits are authored as `K S Pankaj <pankqx@gmail.com>`, with no co-author lines.**
- Keep it build-free: no frameworks or bundlers. A new library goes in `vendor/` and is loaded with `loadScript()`.
- Write interface text in plain, short English. Buttons say what they do ("Close list", not "Submit").
- Every data change goes through the store (`store-local.js` and `store-firebase.js` — keep both in step) and writes a line with `log()`.
- Test both themes, and a phone width (390 px), before pushing.
- Bump the `CACHE` name in `sw.js` on every release.

## More guidance

- Keep changes compatible with the existing no-build ES module setup and offline use. Do not add a runtime or package dependency for routine app behavior.
- Shared dispatch rules and derived box totals belong in `js/common.js`; scanned label normalization belongs in `js/parse.js`; persistence belongs in `js/store-local.js`.
- Treat `totalWeight` as derived from all box label weights unless a user explicitly enters a weighbridge override (`weightEntered`). Recompute derived totals when saving dispatch changes.
- Preserve existing role checks, audit logging, duplicate checks, and offline behavior when changing dispatch flows.
- Escape user-provided values before inserting them into HTML, following the existing `esc` helpers.
- Keep user-facing labels and number/date formatting consistent with the existing Indian locale conventions.
- Weight numbers are read by `weightNumber()` in `common.js` (used by `parseWeight()` and `totals()`).

## Quick test

1. Open in a private window. Go to `#/control` and sign in with the admin password.
2. People → Add person → Access: Manager. Sign out, then sign in as the manager. Settings and New list should be hidden.
3. As admin: New list → fill the details → take the photo → scan
   `PS Box Num: 4270036177-1 Box Weight: 28.7` and press Enter. The total should show 28.7.
4. Close the list → Preview → PDF. The table should have a weight column and a totals row.
