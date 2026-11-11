import test from 'node:test';
import assert from 'node:assert/strict';
import {retireOfflineWorker} from '../src/web/retire-offline.js';
test('retirement unregisters only the former same-origin offline worker',async()=>{
    const removed=[];
    const urls=['https://example.com/offline-sw.js','https://example.com/another-sw.js','https://other.example/offline-sw.js'];
    const registrations=urls.map(url=>({active:{scriptURL:url},unregister:async()=>removed.push(url)}));
    await retireOfflineWorker({getRegistrations:async()=>registrations},'https://example.com');
    assert.deepEqual(removed,[urls[0]]);
});
test('retirement tolerates absent or restricted service worker APIs',async()=>{
    await retireOfflineWorker(undefined,'https://example.com');
    await retireOfflineWorker({getRegistrations:async()=>{throw new Error('restricted');}},'https://example.com');
});
