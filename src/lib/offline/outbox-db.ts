// IndexedDB wrapper for offline order queueing — no external dependencies.
// Database: favo-offline  ·  Store: orders  ·  Key: clientUuid
// Only called from browser context (client components / hooks).

const DB_NAME = "favo-offline";
const DB_VERSION = 1;
const STORE = "orders";

export type OfflineOrder = {
  clientUuid: string;
  staffId: string;
  customerId?: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
    modifications: string[];
  }>;
  paymentMode: "wallet" | "yoco_deferred" | "free";
  clientTotalZar: number;
  clientTimestamp: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "clientUuid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putOrder(order: OfflineOrder): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(order);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getAllOrders(): Promise<OfflineOrder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as OfflineOrder[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteOrder(clientUuid: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientUuid);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function countOrders(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
