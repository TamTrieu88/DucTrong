export const db = {};
export const getFirestore = () => db;

const STORE_KEY = 'duc-trong-local-db';

const loadDb = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch (e) {
    return {};
  }
};

const saveDb = (data: any) => {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
};

const getTable = (name: string) => {
  const data = loadDb();
  if (!data[name]) data[name] = {};
  return data[name];
};

const saveTable = (name: string, table: any) => {
  const data = loadDb();
  data[name] = table;
  saveDb(data);
  notifyListeners(name);
};

const listeners: Record<string, Function[]> = {};
const notifyListeners = (collectionName: string) => {
  if (listeners[collectionName]) {
    const snap = getSnapshot(collectionName);
    listeners[collectionName].forEach((cb: Function) => cb(snap));
  }
};

export const collection = (dbInstance: any, name: string) => ({ type: 'collection', name });

export function doc(...args: any[]) {
  const dbInstance = args[0];
  const colNameOrCollection = args.length > 1 ? args[1] : undefined;
  const id = args.length > 2 ? args[2] : undefined;
  
  let col = '';
  let docId = id;
  
  if (args.length === 1 && dbInstance && dbInstance.type === 'collection') {
     // doc(collectionRef)
     col = dbInstance.name;
     docId = Math.random().toString(36).substring(2, 10);
  } else if (args.length >= 2 && colNameOrCollection?.type === 'collection') {
      if (typeof dbInstance === 'object' && dbInstance.type === 'collection') {
        col = dbInstance.name;
        docId = colNameOrCollection || Math.random().toString(36).substring(2, 10);
      }
  } else if (args.length >= 2 && typeof dbInstance === 'object' && dbInstance.type !== 'collection') {
     col = colNameOrCollection;
     docId = id || Math.random().toString(36).substring(2, 10);
  } else if (args.length >= 3) {
      col = typeof colNameOrCollection === 'string' ? colNameOrCollection : colNameOrCollection?.name;
  } else if (typeof dbInstance === 'object' && dbInstance.type === 'collection') {
      col = dbInstance.name;
      docId = Math.random().toString(36).substring(2, 10);
  }

  return { type: 'doc', col, id: docId };
}

const filterDocs = (docs: any[], constraints?: any[]) => {
    let filtered = [...docs];
    if (constraints) {
        constraints.forEach(c => {
           if (c.type === 'where') {
               filtered = filtered.filter(d => {
                  const val = d.data()[c.field];
                  if (c.op === '==') return val === c.val;
                  if (c.op === '>') return val > c.val;
                  if (c.op === '<') return val < c.val;
                  if (c.op === '>=') return val >= c.val;
                  if (c.op === '<=') return val <= c.val;
                  if (c.op === 'in') return Array.isArray(c.val) && c.val.includes(val);
                  return true;
               });
           }
           if (c.type === 'orderBy') {
               filtered = filtered.sort((a,b) => {
                   const aVal = a.data()[c.field] || '';
                   const bVal = b.data()[c.field] || '';
                   if (c.dir === 'desc') return aVal < bVal ? 1 : -1;
                   return aVal > bVal ? 1 : -1;
               });
           }
           if (c.type === 'limit') {
               filtered = filtered.slice(0, c.num);
           }
        });
    }
    return filtered;
}

const getSnapshot = (queryObj: any) => {
  const colName = typeof queryObj === 'string' ? queryObj : queryObj.name;
  const table = getTable(colName);
  let docs = Object.entries(table).map(([id, data]) => ({
    id,
    data: () => data,
    ref: { type: 'doc', col: colName, id }
  }));

  if (queryObj.constraints) {
    docs = filterDocs(docs, queryObj.constraints);
  }

  return { docs, empty: docs.length === 0, size: docs.length };
};

export const onSnapshot = (queryObj: any, cb: Function) => {
  const colName = queryObj.name;
  if (!listeners[colName]) listeners[colName] = [];
  
  // Wrap cb to filter correctly if it's a query
  const wrappedCb = () => {
      cb(getSnapshot(queryObj));
  };
  
  listeners[colName].push(wrappedCb);
  wrappedCb(); // initial trigger
  return () => {
    listeners[colName] = listeners[colName].filter(l => l !== wrappedCb);
  };
};

export const addDoc = async (col: any, data: any) => {
  const colName = col.name;
  const table = getTable(colName);
  const id = Math.random().toString(36).substring(2, 20);
  table[id] = data;
  saveTable(colName, table);
  return { id, type: 'doc', col: colName };
};

export const updateDoc = async (docRef: any, data: any) => {
  const table = getTable(docRef.col);
  if(table[docRef.id]) {
      table[docRef.id] = { ...table[docRef.id], ...data };
      saveTable(docRef.col, table);
  }
};

export const deleteDoc = async (docRef: any) => {
  const table = getTable(docRef.col);
  delete table[docRef.id];
  saveTable(docRef.col, table);
};

export const query = (col: any, ...constraints: any[]) => {
  return { ...col, constraints: [...(col.constraints || []), ...constraints] };
};

export const where = (field: string, op: string, val: any) => ({ type: 'where', field, op, val });
export const orderBy = (field: string, dir: string = 'asc') => ({ type: 'orderBy', field, dir });
export const limit = (num: number) => ({ type: 'limit', num });

export const getDocs = async (queryObj: any) => {
  return getSnapshot(queryObj);
};

export const writeBatch = (dbInstance?: any) => {
  const batchActions: any[] = [];
  return {
    set: (docRef: any, data: any) => batchActions.push({ type: 'set', docRef, data }),
    update: (docRef: any, data: any) => batchActions.push({ type: 'update', docRef, data }),
    delete: (docRef: any) => batchActions.push({ type: 'delete', docRef }),
    commit: async () => {
      const dataStr = localStorage.getItem(STORE_KEY) || '{}';
      const dbAll = JSON.parse(dataStr);
      let changedCols = new Set<string>();
      
      batchActions.forEach(action => {
         const col = action.docRef.col;
         const id = action.docRef.id;
         if (!dbAll[col]) dbAll[col] = {};
         
         if (action.type === 'set') {
             dbAll[col][id] = action.data;
         } else if (action.type === 'update') {
             dbAll[col][id] = { ...dbAll[col][id], ...action.data };
         } else if (action.type === 'delete') {
             delete dbAll[col][id];
         }
         changedCols.add(col);
      });
      
      localStorage.setItem(STORE_KEY, JSON.stringify(dbAll));
      changedCols.forEach(col => notifyListeners(col));
    }
  };
};

export const handleFirestoreError = (error: any) => {
    console.error(error);
}
