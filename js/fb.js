// Firebase connection. Swapped for a stand-in during automated tests.
import { FIREBASE } from './config.js';
import * as F from '../vendor/firebase.js';

const app = F.initializeApp(FIREBASE);
export const auth = F.getAuth(app);
export const fdb = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
// Local test servers: open the app with ?emu=1
if (new URLSearchParams(location.search).has('emu')) {
  F.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  F.connectFirestoreEmulator(fdb, '127.0.0.1', 8080);
}
export { F };
