// One IndexedDB object store, for the pages that keep things in this browser: the prep page's
// Competition and the References a Stage shows.

/** Runs work in a transaction on the one store of `database`, created on first use. Resolves
 * with the work's request's result once the transaction commits. */
export function objectStore(database: string, store: string) {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return async <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> => {
    const opened = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = opened.transaction(store, mode);
        const request = work(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request?.result as T);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      opened.close();
    }
  };
}
