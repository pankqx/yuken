// Picks the data store: Firebase when configured, otherwise this device.
import { firebaseConfig } from './config.js';

export const S = firebaseConfig ? await import('./store-firebase.js') : await import('./store-local.js');
await S.init();
