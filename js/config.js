// App-wide configuration.
//
// MASTER PIN — resets any account's password (including the admin's) from the
// sign-in screen. Only a salted PBKDF2 hash is stored here, never the PIN.
// After first use, change it in Settings → Master PIN; the new one is kept on
// this computer only and replaces this default.
export const MASTER_PIN = {
  salt: '0867430c1ad8fa8bf92e87c5bcc6daa8',
  hash: '9ac1cc2fc31a1bca2a09bdd593ae7182d1605933bf1ae85d23e86e9b61ac7753',
  iterations: 310000
};

// GOOGLE — one free "OAuth client ID" turns on two things:
//   1. "Sign in with Google" for Chetan (and anyone whose Gmail is linked)
//   2. "Back up to Google Drive" (files go to a "Yuken POL backups" folder)
// Leave it empty and the app works the same with passwords and file backups.
// How to get one: see AGENTS.md → "Turn on Google".
export const GOOGLE_CLIENT_ID = '340433002605-r1ndmcfpg1go4usm5e19oj0c3sgq8jq7.apps.googleusercontent.com';
