// App-wide configuration.
//
// MASTER PIN — resets any account's password (including the admin's) from the
// sign-in screen. Only a salted PBKDF2 hash is stored here, never the PIN.
// After first use, change it in Settings → Master PIN; the new one is kept on
// this computer only and replaces this default.
export const MASTER_PIN = {
  salt: '2ea83ff4a23f8fd90c1da3f43d88d1e3',
  hash: '9b84768797fa6ca08654453bdd6bef9cc3b9214047f6d1353e99796f27653cc4',
  iterations: 310000
};

// GOOGLE — one free "OAuth client ID" turns on two things:
//   1. "Sign in with Google" for Chetan (and anyone whose Gmail is linked)
//   2. "Back up to Google Drive" (files go to a "Yuken POL backups" folder)
// Leave it empty and the app works the same with passwords and file backups.
// How to get one: see AGENTS.md → "Turn on Google".
export const GOOGLE_CLIENT_ID = '';
