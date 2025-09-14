// Basic cache
const CACHE = 'subs-v1';
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./manifest.json'])));
});
self.addEventListener('activate', e=>{ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(res=>res||fetch(e.request)));
});

// Helpers
function toStartOfDay(d){ d=new Date(d); d.setHours(0,0,0,0); return d }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function addMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x }
function addYears(d,n){ const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x }
function nextRenewal(start,cycle,customDays){
  if(!start) return null; let d=new Date(start);
  const today=toStartOfDay(new Date());
  if(cycle==='weekly'){ while(d<=today) d=addDays(d,7); }
  else if(cycle==='monthly'){ while(d<=today) d=addMonths(d,1); }
  else if(cycle==='yearly'){ while(d<=today) d=addYears(d,1); }
  else { const step=Math.max(1,Number(customDays||30)); while(d<=today) d=addDays(d,step); }
  return d;
}

// IndexedDB helpers
function idbOpen(){ return new Promise((resolve,reject)=>{
  const req=indexedDB.open('subs-db',1);
  req.onupgradeneeded=()=>{ const db=req.result;
    if(!db.objectStoreNames.contains('items')) db.createObjectStore('items',{keyPath:'id'}); };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
}); }
function idbGetAll(db){ return new Promise((resolve,reject)=>{
  const tx=db.transaction('items','readonly'); const st=tx.objectStore('items');
  const req=st.getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
}); }

async function checkAndNotify(){
  try{
    const db = await idbOpen(); const list = await idbGetAll(db);
    const today = toStartOfDay(new Date());
    for(const it of list){
      if((it.status||'active')!=='active') continue;
      const next = nextRenewal(it.startDate, it.cycle, it.customDays); if(!next) continue;
      const days = Math.floor((toStartOfDay(next)-today)/86400000);
      const threshold = Number(it.remindBefore||7);
      if(days<=threshold){
        const tag = 'sub-'+it.id+'-'+next.toISOString().slice(0,10);
        await self.registration.showNotification('Sắp đến hạn: '+(it.name||'Thuê bao'),{
          body: `${it.provider||''} • còn ${days<0? ('quá '+Math.abs(days)) : days} ngày • ${next.toLocaleDateString()}`,
          tag
        });
      }
    }
  }catch(e){ console.warn('SW check failed', e); }
}

// Periodic Background Sync
self.addEventListener('periodicsync', e=>{
  if(e.tag==='check-subscriptions'){ e.waitUntil(checkAndNotify()); }
});

// Fallback: one-off sync
self.addEventListener('sync', e=>{
  if(e.tag==='check-subscriptions-once'){ e.waitUntil(checkAndNotify()); }
});

// Also run when SW is activated
self.addEventListener('activate', ()=>{ checkAndNotify(); });
