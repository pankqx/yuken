// Picks the data store: online (Firebase) when js/config.js has a Firebase
// config, otherwise this device only (IndexedDB).
import { FIREBASE } from './config.js';
export const S = FIREBASE.apiKey ? await import('./store-firebase.js') : await import('./store-local.js');
