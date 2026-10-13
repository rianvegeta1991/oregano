// Repository-Schicht: das ist die EINZIGE Stelle, die weiß, wo Daten liegen (IndexedDB).
// Der Rest der App spricht nur mit diesem Objekt (`repo`). Eine spätere Cloud-Synchronisation
// ersetzt oder umhüllt `repo` (z. B. lokal schreiben + Änderungen in eine Warteschlange legen),
// ohne dass Store oder Ansichten angefasst werden müssen.
//
// Stores: items, categories, lists, entries (Listeneinträge), meta (Schlüssel/Wert: Einstellungen u. a.)

const DB_NAME = 'oregano';
const DB_VERSION = 1;
export const STORES = ['items', 'categories', 'lists', 'entries', 'meta'];

function promisify(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
const txDone = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
});

class IdbRepo {
  constructor(db) { this.db = db; this.persistent = true; }

  static async open() {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const os = db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
        if (s === 'entries') os.createIndex('listId', 'listId');
      }
    };
    return new IdbRepo(await promisify(req));
  }
  async all(store) {
    return promisify(this.db.transaction(store).objectStore(store).getAll());
  }
  async put(store, obj) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    return txDone(tx);
  }
  async putMany(store, objs) {
    if (!objs.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const o of objs) os.put(o);
    return txDone(tx);
  }
  async delete(store, id) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    return txDone(tx);
  }
  async deleteMany(store, ids) {
    if (!ids.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const id of ids) os.delete(id);
    return txDone(tx);
  }
  async clear(stores = STORES) {
    const tx = this.db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    return txDone(tx);
  }
}

/** Notnagel (z. B. privates Fenster ohne IndexedDB): läuft nur im Speicher, die App warnt dann. */
class MemoryRepo {
  constructor() { this.persistent = false; this.data = Object.fromEntries(STORES.map((s) => [s, new Map()])); }
  keyOf(store, o) { return store === 'meta' ? o.key : o.id; }
  async all(store) { return [...this.data[store].values()].map((o) => structuredClone(o)); }
  async put(store, o) { this.data[store].set(this.keyOf(store, o), structuredClone(o)); }
  async putMany(store, os) { for (const o of os) await this.put(store, o); }
  async delete(store, id) { this.data[store].delete(id); }
  async deleteMany(store, ids) { for (const id of ids) this.data[store].delete(id); }
  async clear(stores = STORES) { for (const s of stores) this.data[s].clear(); }
}

export async function openRepo() {
  try {
    if (!('indexedDB' in globalThis)) throw new Error('kein IndexedDB');
    return await IdbRepo.open();
  } catch (e) {
    console.warn('IndexedDB nicht verfügbar – nutze Arbeitsspeicher:', e);
    return new MemoryRepo();
  }
}
