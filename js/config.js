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

// ADMIN — the super admin. Nobody can create another admin in the app.
// Online: any of these Google accounts signs in as the admin (the same list is
// in firestore.rules — keep both in step). Single-computer mode: the admin
// password below (only its hash is stored); the master PIN resets it.
export const ADMIN = {
  name: 'Admin',
  email: 'chethu6424@gmail.com',
  emails: ['chethu6424@gmail.com', 'pankqx@gmail.com', 'pankwq@gmail.com'],
  salt: '74cff3fcb9051ffdea57ca65d26a5c4f',
  hash: 'f37f4310b6d761052a84ab61e74db22fa735f7844974b3132f1c51f537bd4e69',
  iterations: 310000
};

// FIREBASE — the shared online database. When filled in, every phone and
// laptop opening the link sees the same people and loading lists, and only
// accounts the admin creates can sign in. Leave apiKey empty to keep the old
// single-computer mode. Paste the "firebaseConfig" from Firebase console →
// Project settings → Your apps → Web app. (These values are meant to be public;
// the security rules in firestore.rules are what protect the data.)
export const FIREBASE = {
  apiKey: 'AIzaSyAPdeaJt9TgEFgPkoULVF3r5ImO86qbbzo',
  authDomain: 'yuken-pol-322c0.firebaseapp.com',
  projectId: 'yuken-pol-322c0',
  storageBucket: 'yuken-pol-322c0.firebasestorage.app',
  messagingSenderId: '940563593715',
  appId: '1:940563593715:web:8a1579e67ce17298e8ba86'
};

// GOOGLE — one free "OAuth client ID" turns on two things:
//   1. "Sign in with Google" for the admin (and anyone whose Gmail is linked)
//   2. "Back up to Google Drive" (files go to a "Yuken POL backups" folder)
// Leave it empty and the app works the same with passwords and file backups.
// How to get one: see AGENTS.md → "Turn on Google".
export const GOOGLE_CLIENT_ID = '340433002605-r1ndmcfpg1go4usm5e19oj0c3sgq8jq7.apps.googleusercontent.com';
