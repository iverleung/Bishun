import { resourceUrl } from '../data/resource-url.js';

// Retire only Bishun's former worker; personal lists and cache contents stay intact.
export async function retireOfflineWorker(serviceWorker, origin) {
    if (!serviceWorker?.getRegistrations) return;
    try {
        for (const registration of await serviceWorker.getRegistrations()) {
            const worker = registration.active || registration.waiting || registration.installing;
            if (!worker) continue;
            const url = new URL(worker.scriptURL);
            if (url.origin === origin && url.pathname === resourceUrl('offline-sw.js')) await registration.unregister();
        }
    } catch { /* Restricted browser storage must not block querying. */ }
}
