// ===== Helpers (giữ nguyên từ bản trước, + thêm IDB) =====
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const storeKey = 'subscription-tracker.v1';

function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
function parseTags(s){return (s||'').split(',').map(x=>x.trim()).filter(Boolean)}
function fmtMoney(v,c){if(v===''||v==null)return '';try{return new Intl.NumberFormat(undefined,{style:'currency',currency:c||'VND',maximumFractionDigits:2}).format(Number(v))}catch{ return `${v} ${c||''}`.trim()}}
function daysBetween(a,b){const MS=86400000;const d=Math.floor((toStartOfDay(b)-toStartOfDay(a))/MS);return d}
function toStartOfDay(d){d=new Date(d);d.setHours(0,0,0,0);return d}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x}
function addYears(d,n){const x=new Date(d);x.setFullYear(x.getFullYear()+n);return x}

function nextRenewal(start,cycle,customDays){
  if(!start) return null; let d = new Date(start); const today=toStartOfDay(new Date());
  if(cycle==='weekly'){
    while(d<=today) d=addDays(d,7);
  }else if(cycle==='monthly'){
    while(d<=today) d=addMonths(d,1);
  }else if(cycle==='yearly'){
    while(d<=today) d=addYears(d,1);
  }else{ // custom
    const step=Math.max(1,Number(customDays||30));
    while(d<=today) d=addDays(d,step);
  }
  return d;
}

function cycleLabel(cycle,customDays){
  return cycle==='custom'? `${customDays||30} ngày`:
         cycle==='weekly'? 'Tuần':
         cycle==='monthly'? 'Tháng':
         cycle==='yearly'? 'Năm': cycle
}

function pctProgress(start,next,cycle,customDays){
  if(!start||!next) return 0; const totalDays=(cycle==='weekly'?7:cycle==='monthly'?30:cycle==='yearly'?365:Math.max(1,Number(customDays||30)));
  const elapsed = totalDays - Math.max(0, daysBetween(new Date(), next));
  return Math.max(0, Math.min(100, Math.round(100*elapsed/totalDays)));
}

// ===== Data layer (LocalStorage + IndexedDB mirror để SW đọc được) =====
function load(){ try{ return JSON.parse(localStorage.getItem(storeKey)||'[]') }catch{ return [] } }
function save(list){ localStorage.setItem(storeKey, JSON.stringify(list)); idbSetAll(list); }

// IndexedDB helper (tối giản)
const IDB = {
  db: null,
  open(){ return new Promise((resolve,reject)=>{ const req = indexedDB.open('subs-db',1); req.onupgradeneeded = ()=>{ const db=req.result; db.createObjectStore('items',{keyPath:'id'}) }; req.onsuccess=()=>{IDB.db=req.result; resolve()}; req.onerror=()=>reject(req.error)}); },
  put(store, val){ return new Promise((res,rej)=>{ const tx=IDB.db.transaction(store,'readwrite'); tx.objectStore(store).put(val); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); },
  clear(store){ return new Promise((res,rej)=>{ const tx=IDB.db.transaction(store,'readwrite'); tx.objectStore(store).clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
};
async function idbSetAll(list){ try{ if(!('indexedDB' in window)) return; if(!IDB.db) await IDB.open(); await IDB.clear('items'); for(const it of list) await IDB.put('items', it); }catch(e){ console.warn('IDB mirror failed', e);} }

// ===== Rendering (như bản trước) =====
function render(){
  const q = $('#search').value.toLowerCase();
  const st = $('#filterStatus').value;
  let list = load();
  list.forEach(it=>{ it.next = nextRenewal(it.startDate, it.cycle, it.customDays); it.daysLeft = it.next? daysBetween(new Date(), it.next) : null; it.progress = pctProgress(it.startDate, it.next, it.cycle, it.customDays); });

  if(q){ list = list.filter(it=> [it.name,it.provider,(it.tags||[]).join(',')].join(' ').toLowerCase().includes(q)); }
  if(st!=='all'){ list = list.filter(it=> (it.status||'active')===st); }

  // sort
  const by=$('#sortBy').value, dir=$('#sortDir').value;
  list.sort((a,b)=>{
    const s = (v)=> (v==null?-Infinity:v);
    if(by==='name') return (a.name||'').localeCompare(b.name||'') * (dir==='asc'?1:-1);
    if(by==='provider') return (a.provider||'').localeCompare(b.provider||'') * (dir==='asc'?1:-1);
    if(by==='price') return ((a.price||0)-(b.price||0)) * (dir==='asc'?1:-1);
    return ((s(a.next?.getTime())-s(b.next?.getTime())))*(dir==='asc'?1:-1);
  });

  const tbody = $('#table tbody');
  tbody.innerHTML = '';
  let totalActive=0, totalMonthlyVND=0;
  list.forEach(it=>{
    if((it.status||'active')==='active'){ totalActive++; }
    const price=Number(it.price||0);
    const factor = it.cycle==='weekly'? 4.345 : it.cycle==='yearly'? 1/12 : it.cycle==='custom'? (30/(Number(it.customDays||30))) : 1;
    totalMonthlyVND += price * factor;

    const tr = document.createElement('tr');
    const days = it.daysLeft;
    const pill = days==null? '<span class="pill">—</span>' : days<0? `<span class="pill due">Quá hạn ${Math.abs(days)} ngày</span>` : days===0? '<span class="pill due">Hôm nay</span>' : days<=Number(it.remindBefore||7)? `<span class="pill soon">Còn ${days} ngày</span>` : `<span class="pill ok">${days} ngày</span>`;

    tr.innerHTML = `
      <td><div style="font-weight:700">${esc(it.name)}</div><div class="small muted">${esc(it.notes||'')}</div></td>
      <td>${esc(it.provider||'')}</td>
      <td>${fmtMoney(it.price,it.currency)}</td>
      <td>${cycleLabel(it.cycle,it.customDays)}<div class="small muted">${esc(it.status||'active')}</div></td>
      <td style="min-width:150px">
        <div class="progress"><i style="width:${it.progress}%"></i></div>
        <div class="small muted">${it.progress}%</div>
      </td>
      <td>${it.next? new Date(it.next).toLocaleDateString(): '—'}</td>
      <td>${pill}</td>
      <td>${(it.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td class="nowrap">
        <button class="ghost" onclick="editItem('${it.id}')">Sửa</button>
        <button class="bad" onclick="delItem('${it.id}')">Xóa</button>
        <div class="small muted" style="margin-top:6px"><a href="#" onclick="downloadICSFor('${it.id}')">.ics</a></div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $('#totals').textContent = `${list.length} mục | hoạt động: ${totalActive} | ~/tháng: ${fmtMoney(totalMonthlyVND,'VND')}`;
}

function esc(s){return (s||'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}

// ===== CRUD =====
$('#cycle').addEventListener('change',()=>{ const isCustom = $('#cycle').value==='custom'; $('#customDaysWrap').classList.toggle('hidden', !isCustom); });

$('#saveBtn').addEventListener('click', ()=>{
  const id = $('#editId').value || uid();
  const item = {
    id,
    name: $('#name').value.trim(),
    provider: $('#provider').value.trim(),
    price: Number($('#price').value||0),
    currency: $('#currency').value.trim()||'VND',
    cycle: $('#cycle').value,
    customDays: Number($('#customDays').value||30),
    startDate: $('#startDate').value? new Date($('#startDate').value).toISOString(): null,
    remindBefore: Number($('#remindBefore').value||7),
    tags: parseTags($('#tags').value),
    status: $('#status').value,
    notes: $('#notes').value.trim()
  };
  if(!item.name){ alert('Vui lòng nhập tên dịch vụ'); return }
  if(!item.startDate){ alert('Chọn ngày bắt đầu/lần thanh toán gần nhất'); return }

  const list = load();
  const idx = list.findIndex(x=>x.id===id);
  if(idx>-1) list[idx]=item; else list.push(item);
  save(list);
  clearForm();
  render();
});

$('#resetBtn').addEventListener('click', clearForm);
function clearForm(){
  $('#editId').value='';
  ['name','provider','price','currency','customDays','startDate','remindBefore','tags','notes'].forEach(id=>{$('#'+id).value=''});
  $('#currency').value='VND';
  $('#cycle').value='monthly';
  $('#status').value='active';
  $('#customDaysWrap').classList.add('hidden');
}

function editItem(id){
  const it = load().find(x=>x.id===id); if(!it) return;
  $('#editId').value = it.id;
  $('#name').value = it.name||'';
  $('#provider').value = it.provider||'';
  $('#price').value = it.price||'';
  $('#currency').value = it.currency||'VND';
  $('#cycle').value = it.cycle||'monthly';
  $('#customDays').value = it.customDays||30; $('#customDaysWrap').classList.toggle('hidden', it.cycle!=='custom');
  $('#startDate').value = it.startDate? new Date(it.startDate).toISOString().slice(0,10): '';
  $('#remindBefore').value = it.remindBefore||7;
  $('#tags').value = (it.tags||[]).join(', ');
  $('#status').value = it.status||'active';
  $('#notes').value = it.notes||'';
  window.scrollTo({top:0,behavior:'smooth'});
}

function delItem(id){ if(!confirm('Xóa thuê bao này?')) return; const list = load().filter(x=>x.id!==id); save(list); render(); }

['search','filterStatus','sortBy','sortDir'].forEach(id=>{ $('#'+id).addEventListener('input', render); });

// ===== Import / Export =====
$('#exportJSON').addEventListener('click',()=>{ const blob = new Blob([JSON.stringify(load(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.json'; a.click(); URL.revokeObjectURL(a.href); });

$('#importJSON').addEventListener('click',()=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json'; inp.onchange=()=>{ const f=inp.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ const data=JSON.parse(r.result); if(Array.isArray(data)){ save(data); render(); } else alert('Tệp không hợp lệ'); }catch(e){ alert('Không đọc được JSON') } }; r.readAsText(f); }; inp.click(); });

$('#exportCSV').addEventListener('click',()=>{ const list = load(); const header = ['name','provider','price','currency','cycle','customDays','startDate','remindBefore','tags','status','notes']; const rows = [header.join(',')].concat(list.map(it=> header.map(k=>{ let v = it[k]; if(Array.isArray(v)) v=v.join('|'); if(v==null) v=''; return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','))); const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.csv'; a.click(); URL.revokeObjectURL(a.href); });

function icsEscape(s){return String(s||'').replace(/[\\,;]/g,'\\$&').replace(/\n/g,'\\n')}
function pad(n){return (n<10?'0':'')+n}
function fmtICSDate(d){ const y=d.getFullYear(), m=pad(d.getMonth()+1), da=pad(d.getDate()); return `${y}${m}${da}`; }
function makeICSForItem(it){ const next = nextRenewal(it.startDate, it.cycle, it.customDays); if(!next) return ''; let rrule=''; if(it.cycle==='weekly') rrule='RRULE:FREQ=WEEKLY'; else if(it.cycle==='monthly') rrule='RRULE:FREQ=MONTHLY'; else if(it.cycle==='yearly') rrule='RRULE:FREQ=YEARLY'; else rrule=`RRULE:FREQ=DAILY;INTERVAL=${Math.max(1,Number(it.customDays||30))}`; const dt = fmtICSDate(next); const alarmDays = Math.max(0, Number(it.remindBefore||7)); const trigger = `TRIGGER:-P${alarmDays}D`; const uidStr = it.id+'@subscription-tracker'; const title = `Gia hạn: ${it.name}`; const desc = `Nhà cung cấp: ${it.provider||''}\\nGiá/kỳ: ${it.price||''} ${it.currency||''}\\nChu kỳ: ${cycleLabel(it.cycle,it.customDays)}\\nGhi chú: ${icsEscape(it.notes||'')}`; return ['BEGIN:VEVENT',`UID:${uidStr}`,`DTSTAMP:${fmtICSDate(new Date())}T000000`,`SUMMARY:${icsEscape(title)}`,`DESCRIPTION:${desc}`,`DTSTART;VALUE=DATE:${dt}`,rrule,'BEGIN:VALARM',trigger,'ACTION:DISPLAY',`DESCRIPTION:${icsEscape(title)}`,'END:VALARM','END:VEVENT'].join('\n'); }
function downloadICSFor(id){ const it = load().find(x=>x.id===id); if(!it) return; const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Subscription Tracker//EN', makeICSForItem(it), 'END:VCALENDAR' ].join('\n'); const blob = new Blob([body],{type:'text/calendar'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${(it.name||'subscription')}.ics`; a.click(); URL.revokeObjectURL(a.href); }
$('#downloadICS').addEventListener('click',()=>{ const items = load(); const events = items.map(makeICSForItem).filter(Boolean).join('\n'); const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Subscription Tracker//EN', events, 'END:VCALENDAR'].join('\n'); const blob=new Blob([body],{type:'text/calendar'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.ics'; a.click(); URL.revokeObjectURL(a.href); });

// ===== PWA / Notifications =====
function setSupportNote(){
  const okPWA = 'serviceWorker' in navigator;
  const okPBS = 'periodicSync' in (navigator.serviceWorker?.ready||{});
  const ua = navigator.userAgent;
  let msg = 'Thiết bị hỗ trợ: ' + (okPWA? 'Service Worker':'(không)') + ' • ' + (('Notification' in window)? 'Notifications':'(no Notifications)');
  msg += '\nPeriodic Background Sync: ' + (('periodicSync' in (navigator))? '(browser check in SW)':'kiểm tra khi đăng ký');
  if(/iPhone|iPad|Macintosh/.test(ua)) msg += '\nLưu ý: iOS/macOS hiện chưa hỗ trợ Periodic Background Sync. Hãy import .ics để có nhắc chắc chắn.';
  $('#supportNote').textContent = msg;
}

async function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    console.log('SW ready');
  }catch(e){ console.error('SW register failed', e); }
}

$('#enableNotify').addEventListener('click', async ()=>{
  try{
    // 1) Request notification permission
    if(!('Notification' in window)) return alert('Trình duyệt không hỗ trợ Notification API');
    const perm = await Notification.requestPermission();
    if(perm!=='granted') return alert('Bạn đã từ chối thông báo');

    // 2) Register SW
    await registerSW();
    const reg = await navigator.serviceWorker.ready;

    // 3) Register Periodic Background Sync if available
    if('periodicSync' in reg){
      try{
        // 12 giờ/lần
        await reg.periodicSync.register('check-subscriptions', { minInterval: 12*60*60*1000 });
        alert('Đã bật nhắc nền (Periodic Background Sync)');
      }catch(err){
        console.warn('PBS register failed', err);
        alert('Không bật được nhắc nền tự động trên thiết bị này. Bạn vẫn sẽ nhận nhắc khi mở app. Hãy import .ics để chắc chắn.');
      }
    } else {
      alert('Thiết bị không hỗ trợ Periodic Background Sync. Hãy import .ics hoặc mở app thỉnh thoảng để nhận nhắc.');
    }
  }catch(e){
    alert('Không bật được thông báo: '+e);
  }
});

window.addEventListener('load',()=>{ render(); scheduleChecks(); setSupportNote(); registerSW(); });

// Vẫn giữ scheduleChecks cho khi app đang mở
function scheduleChecks(){ try{ checkDue(); }catch{} setInterval(()=>{ try{ checkDue(); }catch{} }, 60*60*1000); }
function checkDue(){ if(!('Notification' in window) || Notification.permission!=='granted') return; const list = load(); const today=toStartOfDay(new Date()); list.forEach(it=>{ if((it.status||'active')!=='active') return; const next = nextRenewal(it.startDate, it.cycle, it.customDays); if(!next) return; const days = daysBetween(today, next); const threshold = Number(it.remindBefore||7); const key = 'notified-'+it.id+'-'+next.toISOString().slice(0,10); if(days<=threshold){ if(sessionStorage.getItem(key)) return; new Notification('Sắp đến hạn: '+(it.name||'Thuê bao'),{ body:`${it.provider||''} • còn ${days<0? ('quá '+Math.abs(days)) : days} ngày • ${next.toLocaleDateString()}`}); sessionStorage.setItem(key,'1'); } }); }
