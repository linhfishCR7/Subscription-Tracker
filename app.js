/* ===================== CONFIG – THAY BẰNG CỦA BẠN ===================== */
// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBNOpqERIekiDXLuxvG1TsGAI18FZAJpu8",
  authDomain: "subscription-tracker-17926.firebaseapp.com",
  projectId: "subscription-tracker-17926",
  storageBucket: "subscription-tracker-17926.firebasestorage.app",
  messagingSenderId: "698189849861",
  appId: "1:698189849861:web:48f60ed743e07377c0036c"
};

// Google OAuth Client ID (dùng chung cho Gmail + Calendar)
const GOOGLE_CLIENT_ID = "781824072979-3q3a2946mlppep7geqrpvbhpbfbb3v44.apps.googleusercontent.com";

// Scopes
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GCAL_SCOPE  = "https://www.googleapis.com/auth/calendar";

// Tên calendar sẽ tạo/đồng bộ
const GCAL_CAL_SUMMARY = "Subscriptions – Auto";
/* ===================================================================== */

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let gmailAccessToken = null, gcalAccessToken = null;
let gmailTokenClient = null, gcalTokenClient  = null;

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const storeKey = 'subscription-tracker.v1';

function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
function parseTags(s){return (s||'').split(',').map(x=>x.trim()).filter(Boolean)}
function fmtMoney(v,c){if(v===''||v==null)return '';try{return new Intl.NumberFormat(undefined,{style:'currency',currency:c||'VND',maximumFractionDigits:2}).format(Number(v))}catch{ return `${v} ${c||''}`.trim()}}
function daysBetween(a,b){const MS=86400000;return Math.floor((toStartOfDay(b)-toStartOfDay(a))/MS)}
function toStartOfDay(d){d=new Date(d);d.setHours(0,0,0,0);return d}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x}
function addYears(d,n){const x=new Date(d);x.setFullYear(x.getFullYear()+n);return x}
function nextRenewal(start,cycle,customDays){
  if(!start) return null; let d = new Date(start); const today=toStartOfDay(new Date());
  if(cycle==='weekly'){ while(d<=today) d=addDays(d,7); }
  else if(cycle==='monthly'){ while(d<=today) d=addMonths(d,1); }
  else if(cycle==='yearly'){ while(d<=today) d=addYears(d,1); }
  else { const step=Math.max(1,Number(customDays||30)); while(d<=today) d=addDays(d,step); }
  return d;
}
function cycleLabel(c,cd){return c==='custom'?`${cd||30} ngày`:c==='weekly'?'Tuần':c==='monthly'?'Tháng':c==='yearly'?'Năm':c}
function pctProgress(start,next,cycle,customDays){
  if(!start||!next) return 0;
  const total=(cycle==='weekly'?7:cycle==='monthly'?30:cycle==='yearly'?365:Math.max(1,Number(customDays||30)));
  const elapsed = total - Math.max(0, daysBetween(new Date(), next));
  return Math.max(0, Math.min(100, Math.round(100*elapsed/total)));
}

/* ===== LocalStorage + IDB (mirror cho SW) ===== */
function loadLocal(){ try{ return JSON.parse(localStorage.getItem(storeKey)||'[]') }catch{ return [] } }
function saveLocal(list){ localStorage.setItem(storeKey, JSON.stringify(list)); idbSetAll(list); }

const IDB = {
  db:null,
  open(){ return new Promise((ok,err)=>{ const r=indexedDB.open('subs-db',1);
    r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains('items')) db.createObjectStore('items',{keyPath:'id'}) };
    r.onsuccess=()=>{IDB.db=r.result; ok()}; r.onerror=()=>err(r.error);
  }); },
  put(val){ return new Promise((ok,err)=>{ const tx=IDB.db.transaction('items','readwrite'); tx.objectStore('items').put(val); tx.oncomplete=()=>ok(); tx.onerror=()=>err(tx.error); }); },
  clear(){ return new Promise((ok,err)=>{ const tx=IDB.db.transaction('items','readwrite'); tx.objectStore('items').clear(); tx.oncomplete=()=>ok(); tx.onerror=()=>err(tx.error); }); }
};
async function idbSetAll(list){ try{ if(!('indexedDB' in window)) return; if(!IDB.db) await IDB.open(); await IDB.clear(); for(const it of list) await IDB.put(it); }catch(e){ console.warn('IDB mirror failed', e);} }

/* ===== Firestore sync ===== */
async function syncFromFirestore(){
  if(!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const snap = await db.collection("users").doc(uid).collection("subscriptions").get();
  const list = snap.docs.map(d=>d.data());
  saveLocal(list);
  render();
}
async function upsertToFirestore(item){
  if(!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  await db.collection("users").doc(uid).collection("subscriptions").doc(item.id).set(item);
}
async function deleteFromFirestore(id){
  if(!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  await db.collection("users").doc(uid).collection("subscriptions").doc(id).delete();
}

/* ===== UI render ===== */
function render(){
  const q = $('#search').value.toLowerCase();
  const st = $('#filterStatus').value;
  let list = loadLocal();
  list.forEach(it=>{ it.next=nextRenewal(it.startDate,it.cycle,it.customDays); it.daysLeft=it.next?daysBetween(new Date(),it.next):null; it.progress=pctProgress(it.startDate,it.next,it.cycle,it.customDays); });

  if(q)  list = list.filter(it=> [it.name,it.provider,(it.tags||[]).join(',')].join(' ').toLowerCase().includes(q));
  if(st!=='all') list = list.filter(it=> (it.status||'active')===st);

  const by=$('#sortBy').value, dir=$('#sortDir').value;
  list.sort((a,b)=>{
    const s=v=>v==null?-Infinity:v;
    if(by==='name') return (a.name||'').localeCompare(b.name||'')*(dir==='asc'?1:-1);
    if(by==='provider') return (a.provider||'').localeCompare(b.provider||'')*(dir==='asc'?1:-1);
    if(by==='price') return ((a.price||0)-(b.price||0))*(dir==='asc'?1:-1);
    return ((s(a.next?.getTime())-s(b.next?.getTime())))*(dir==='asc'?1:-1);
  });

  const tbody = $('#table tbody'); tbody.innerHTML='';
  let totalActive=0,totalMonthly=0;
  list.forEach(it=>{
    if((it.status||'active')==='active') totalActive++;
    const factor = it.cycle==='weekly'?4.345:it.cycle==='yearly'?1/12:it.cycle==='custom'?(30/(Number(it.customDays||30))):1;
    totalMonthly += Number(it.price||0)*factor;

    const days=it.daysLeft;
    const pill = days==null? '<span class="pill">—</span>' :
      days<0? `<span class="pill due">Quá hạn ${Math.abs(days)} ngày</span>` :
      days===0? '<span class="pill due">Hôm nay</span>' :
      days<=Number(it.remindBefore||7)? `<span class="pill soon">Còn ${days} ngày</span>` :
      `<span class="pill ok">${days} ngày</span>`;

    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td><div style="font-weight:700">${esc(it.name)}</div><div class="small muted">${esc(it.notes||'')}</div></td>
      <td>${esc(it.provider||'')}</td>
      <td>${fmtMoney(it.price,it.currency)}</td>
      <td>${cycleLabel(it.cycle,it.customDays)}<div class="small muted">${esc(it.status||'active')}</div></td>
      <td style="min-width:150px">
        <div class="progress"><i style="width:${it.progress}%"></i></div>
        <div class="small muted">${it.progress}%</div>
      </td>
      <td>${it.next?new Date(it.next).toLocaleDateString():'—'}</td>
      <td>${pill}</td>
      <td>${(it.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td class="nowrap">
        <button class="ghost" onclick="editItem('${it.id}')">Sửa</button>
        <button class="bad" onclick="delItem('${it.id}')">Xóa</button>
        <div class="small muted" style="margin-top:6px"><a href="#" onclick="downloadICSFor('${it.id}')">.ics</a></div>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#totals').textContent = `${list.length} mục | hoạt động: ${totalActive} | ~/tháng: ${fmtMoney(totalMonthly,'VND')}`;
}
function esc(s){return (s||'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}

/* ===== CRUD ===== */
$('#cycle').addEventListener('change',()=>$('#customDaysWrap').classList.toggle('hidden',$('#cycle').value!=='custom'));

$('#saveBtn').addEventListener('click', async ()=>{
  const id=$('#editId').value||uid();
  let item={
    id,
    name:$('#name').value.trim(),
    provider:$('#provider').value.trim(),
    price:Number($('#price').value||0),
    currency:$('#currency').value.trim()||'VND',
    cycle:$('#cycle').value,
    customDays:Number($('#customDays').value||30),
    startDate:$('#startDate').value?new Date($('#startDate').value).toISOString():null,
    remindBefore:Number($('#remindBefore').value||7),
    tags:parseTags($('#tags').value),
    status:$('#status').value,
    notes:$('#notes').value.trim(),
    gcalEventId: (loadLocal().find(x=>x.id===id)||{}).gcalEventId || null,
    gcalCalendarId: (loadLocal().find(x=>x.id===id)||{}).gcalCalendarId || null
  };
  if(!item.name) return alert('Vui lòng nhập tên dịch vụ');
  if(!item.startDate) return alert('Chọn ngày bắt đầu/lần thanh toán gần nhất');

  const list=loadLocal(); const idx=list.findIndex(x=>x.id===id);
  if(idx>-1) list[idx]=item; else list.push(item);
  saveLocal(list); render();

  try{
    await upsertToFirestore(item);
    if(gcalAccessToken){
      const updated = await syncItemToCalendar(item);
      if(updated){ item = {...item, ...updated}; await upsertToFirestore(item); const list2=loadLocal().map(x=>x.id===item.id?item:x); saveLocal(list2); render(); }
    }
  }catch(e){ console.warn('Save/Sync error', e); }
  clearForm();
});

$('#resetBtn').addEventListener('click', clearForm);
function clearForm(){
  $('#editId').value='';
  ['name','provider','price','currency','customDays','startDate','remindBefore','tags','notes'].forEach(id=>$('#'+id).value='');
  $('#currency').value='VND'; $('#cycle').value='monthly'; $('#status').value='active';
  $('#customDaysWrap').classList.add('hidden');
}
function editItem(id){
  const it=loadLocal().find(x=>x.id===id); if(!it) return;
  $('#editId').value=it.id; $('#name').value=it.name||''; $('#provider').value=it.provider||'';
  $('#price').value=it.price||''; $('#currency').value=it.currency||'VND';
  $('#cycle').value=it.cycle||'monthly'; $('#customDays').value=it.customDays||30;
  $('#customDaysWrap').classList.toggle('hidden', it.cycle!=='custom');
  $('#startDate').value=it.startDate?new Date(it.startDate).toISOString().slice(0,10):'';
  $('#remindBefore').value=it.remindBefore||7; $('#tags').value=(it.tags||[]).join(', ');
  $('#status').value=it.status||'active'; $('#notes').value=it.notes||'';
  window.scrollTo({top:0,behavior:'smooth'});
}
async function delItem(id){
  if(!confirm('Xóa thuê bao này?')) return;
  const it = loadLocal().find(x=>x.id===id);
  const list=loadLocal().filter(x=>x.id!==id); saveLocal(list); render();
  try{
    await deleteFromFirestore(id);
    if(gcalAccessToken && it?.gcalCalendarId && it?.gcalEventId){
      await gcalDeleteEvent(it.gcalCalendarId, it.gcalEventId);
    }
  }catch(e){ console.warn('Delete/Sync error',e); }
}

/* ===== Import/Export ===== */
$('#exportJSON').addEventListener('click',()=>{ const blob=new Blob([JSON.stringify(loadLocal(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.json'; a.click(); URL.revokeObjectURL(a.href); });
$('#importJSON').addEventListener('click',()=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json'; inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return; const r=new FileReader(); r.onload=async()=>{ try{ const data=JSON.parse(r.result); if(Array.isArray(data)){ saveLocal(data); render(); if(auth.currentUser){ for(const it of data){ await upsertToFirestore(it); if(gcalAccessToken){ const updated = await syncItemToCalendar(it); if(updated){ const list=loadLocal().map(x=>x.id===it.id?{...it,...updated}:x); saveLocal(list); await upsertToFirestore({...it,...updated}); } } } } } else alert('Tệp không hợp lệ'); }catch(e){ alert('Không đọc được JSON') } }; r.readAsText(f); }; inp.click(); });
$('#exportCSV').addEventListener('click',()=>{ const list=loadLocal(); const header=['name','provider','price','currency','cycle','customDays','startDate','remindBefore','tags','status','notes']; const rows=[header.join(',')].concat(list.map(it=> header.map(k=>{ let v=it[k]; if(Array.isArray(v)) v=v.join('|'); if(v==null) v=''; return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','))); const blob=new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.csv'; a.click(); URL.revokeObjectURL(a.href); });

/* ===== iCal (giữ lại, nhưng Calendar đã tự sync) ===== */
function icsEscape(s){return String(s||'').replace(/[\\,;]/g,'\\$&').replace(/\n/g,'\\n')}
function pad(n){return (n<10?'0':'')+n}
function fmtICSDate(d){const y=d.getFullYear(),m=pad(d.getMonth()+1),da=pad(d.getDate());return `${y}${m}${da}`;}
function makeICSForItem(it){ const next=nextRenewal(it.startDate,it.cycle,it.customDays); if(!next) return ''; let rrule=''; if(it.cycle==='weekly') rrule='RRULE:FREQ=WEEKLY'; else if(it.cycle==='monthly') rrule='RRULE:FREQ=MONTHLY'; else if(it.cycle==='yearly') rrule='RRULE:FREQ=YEARLY'; else rrule=`RRULE:FREQ=DAILY;INTERVAL=${Math.max(1,Number(it.customDays||30))}`; const dt=fmtICSDate(next); const alarmDays=Math.max(0,Number(it.remindBefore||7)); const trigger=`TRIGGER:-P${alarmDays}D`; const uidStr=it.id+'@subscription-tracker'; const title=`Gia hạn: ${it.name}`; const desc=`Nhà cung cấp: ${it.provider||''}\\nGiá/kỳ: ${it.price||''} ${it.currency||''}\\nChu kỳ: ${cycleLabel(it.cycle,it.customDays)}\\nGhi chú: ${icsEscape(it.notes||'')}`; return ['BEGIN:VEVENT',`UID:${uidStr}`,`DTSTAMP:${fmtICSDate(new Date())}T000000`,`SUMMARY:${icsEscape(title)}`,`DESCRIPTION:${desc}`,`DTSTART;VALUE=DATE:${dt}`,rrule,'BEGIN:VALARM',trigger,'ACTION:DISPLAY',`DESCRIPTION:${icsEscape(title)}`,'END:VALARM','END:VEVENT'].join('\n'); }
function downloadICSFor(id){ const it=loadLocal().find(x=>x.id===id); if(!it) return; const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Subscription Tracker//EN',makeICSForItem(it),'END:VCALENDAR'].join('\n'); const blob=new Blob([body],{type:'text/calendar'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${(it.name||'subscription')}.ics`; a.click(); URL.revokeObjectURL(a.href); }
$('#downloadICS').addEventListener('click',()=>{ const items=loadLocal(); const events=items.map(makeICSForItem).filter(Boolean).join('\n'); const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Subscription Tracker//EN',events,'END:VCALENDAR'].join('\n'); const blob=new Blob([body],{type:'text/calendar'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='subscriptions.ics'; a.click(); URL.revokeObjectURL(a.href); });

/* ===== PWA / Notifications ===== */
function setSupportNote(){
  const okSW='serviceWorker' in navigator;
  const okNot='Notification' in window;
  let msg = `SW: ${okSW?'OK':'Không'} • Notifications: ${okNot?'OK':'Không'}`;
  msg += `\nĐã có Google Calendar: sự kiện/nhắc sẽ đồng bộ qua cloud trên mọi thiết bị.`;
  $('#supportNote').textContent=msg;
}
async function registerSW(){ if(!('serviceWorker' in navigator)) return; try{ await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; }catch(e){ console.error('SW register failed',e); } }
$('#enableNotify').addEventListener('click', async ()=>{
  if(!('Notification' in window)) return alert('Trình duyệt không hỗ trợ Notification API');
  const perm = await Notification.requestPermission();
  if(perm!=='granted') return alert('Bạn đã từ chối thông báo');
  await registerSW();
  const reg = await navigator.serviceWorker.ready;
  if('periodicSync' in reg){
    try{ await reg.periodicSync.register('check-subscriptions',{minInterval:12*60*60*1000}); alert('Đã bật nhắc nền (Periodic Background Sync)'); }
    catch(e){ console.warn('PBS failed',e); alert('Thiết bị không bật được nhắc nền. Không sao, đã có Google Calendar nhắc qua cloud.'); }
  } else {
    alert('Thiết bị không hỗ trợ Periodic Background Sync. Không sao, đã có Google Calendar nhắc qua cloud.');
  }
});
function scheduleChecks(){ try{ checkDue(); }catch{} setInterval(()=>{ try{ checkDue(); }catch{} }, 60*60*1000); }
function checkDue(){ if(!('Notification' in window)||Notification.permission!=='granted') return; const list=loadLocal(); const today=toStartOfDay(new Date()); list.forEach(it=>{ if((it.status||'active')!=='active') return; const next=nextRenewal(it.startDate,it.cycle,it.customDays); if(!next) return; const days=daysBetween(today,next); const threshold=Number(it.remindBefore||7); const key='notified-'+it.id+'-'+next.toISOString().slice(0,10); if(days<=threshold){ if(sessionStorage.getItem(key)) return; new Notification('Sắp đến hạn: '+(it.name||'Thuê bao'),{ body:`${it.provider||''} • còn ${days<0?('quá '+Math.abs(days)):days} ngày • ${next.toLocaleDateString()}`}); sessionStorage.setItem(key,'1'); } }); }

/* ===== Auth ===== */
$('#btnLogin').addEventListener('click', async ()=>{
  const provider=new firebase.auth.GoogleAuthProvider();
  provider.addScope('profile'); provider.addScope('email');
  try{ await auth.signInWithPopup(provider); }catch(e){ alert('Login lỗi: '+e.message); }
});
$('#btnLogout').addEventListener('click', ()=>auth.signOut());

auth.onAuthStateChanged(async (user)=>{
  if(user){
    $('#btnLogin').classList.add('hidden');
    $('#btnLogout').classList.remove('hidden');
    $('#btnGmail').classList.remove('hidden');
    $('#btnCalendar').classList.remove('hidden');
    $('#userInfo').textContent = `${user.displayName||user.email||'Đã đăng nhập'}`;
    await syncFromFirestore();
  }else{
    $('#btnLogin').classList.remove('hidden');
    $('#btnLogout').classList.add('hidden');
    $('#btnGmail').classList.add('hidden');
    $('#btnCalendar').classList.add('hidden');
    $('#userInfo').textContent = '';
  }
});

/* ===== Gmail OAuth (GIS) ===== */
window.addEventListener('load', ()=>{
  setSupportNote(); registerSW(); render(); scheduleChecks();

  // Token client Gmail
  gmailTokenClient = google?.accounts?.oauth2?.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GMAIL_SCOPE,
    callback: (resp)=>{ if(resp.access_token){ gmailAccessToken=resp.access_token; scanGmail(); } }
  });

  // Token client Calendar
  gcalTokenClient = google?.accounts?.oauth2?.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GCAL_SCOPE,
    prompt: '', // refresh im lặng nếu đã cấp
    callback: (resp)=>{ if(resp.access_token){ gcalAccessToken=resp.access_token; alert('Đã kết nối Calendar. Mọi thay đổi sẽ tự đồng bộ.'); } }
  });
});

$('#btnGmail').addEventListener('click', ()=>{ gmailTokenClient?.requestAccessToken({prompt:'consent'}); });
$('#btnCalendar').addEventListener('click', ()=>{ gcalTokenClient?.requestAccessToken({prompt:'consent'}); });

/* ===== Gmail scan (gợi ý) ===== */
async function scanGmail(){
  if(!gmailAccessToken) return alert('Chưa có Gmail access token');
  const q = encodeURIComponent('subject:(receipt OR invoice OR subscription OR renewed OR Biên nhận OR biên nhận OR Billing Reminder) newer_than:2y');
  const listURL = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=50`;
  const headers = {Authorization:'Bearer '+gmailAccessToken};
  try{
    const listRes = await fetch(listURL,{headers}); const listData = await listRes.json();
    if(!listData.messages?.length) return alert('Không tìm thấy email nào phù hợp');
    const suggestions = [];
    for(const m of listData.messages.slice(0,20)){
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,{headers});
      const msg = await msgRes.json();
      const hdrs = (msg.payload?.headers||[]);
      const H = n => hdrs.find(h=>h.name===n)?.value || '';
      const from = H('From'), subject = H('Subject'), date = H('Date');
      const provider = guessProvider(from, subject);
      const name = guessName(subject, provider);
      const startDateISO = new Date(date).toISOString();
      if(provider || /subscription|renew/i.test(subject)){
        suggestions.push({id: msg.id, name, provider, startDate: startDateISO});
      }
    }
    if(!suggestions.length) return alert('Chưa phát hiện được gói nào từ email.');
    const list = loadLocal(); let added=0;
    for(const s of suggestions){
      const id = 'gmail-'+s.id;
      if(list.find(x=>x.id===id)) continue;
      const item = {
        id,
        name: s.name || s.provider || 'Subscription',
        provider: s.provider || '',
        price: 0, currency: 'VND',
        cycle: 'monthly', customDays: 30,
        startDate: s.startDate, remindBefore: 7,
        tags: ['gmail-scan'], status: 'active',
        notes: `Gợi ý từ Gmail: ${s.provider||''} / ${s.name||''}`,
        gcalEventId: null, gcalCalendarId: null
      };
      list.push(item);
      await upsertToFirestore(item);
      if(gcalAccessToken){ const updated = await syncItemToCalendar(item); if(updated){ Object.assign(item, updated); await upsertToFirestore(item); } }
      added++;
    }
    saveLocal(list); render();
    alert(`Đã gợi ý thêm ${added} mục (tag: gmail-scan). Hãy cập nhật giá/chu kỳ cho chính xác.`);
  }catch(e){ console.error(e); alert('Lỗi khi đọc Gmail: '+(e.message||e)); }
}
function guessProvider(from, subject){
  const all = (from+' '+subject).toLowerCase();
  const map = ['google','apple','netflix','spotify','adobe','microsoft','canva','dropbox','evernote','1password','notion','openai','github','zoom','slack','atlassian','amazon','hbo','disney','icloud','youtube'];
  return map.find(k=> all.includes(k)) || '';
}
function guessName(subject, provider){
  subject = (subject||'').replace(/\[.*?\]/g,'').trim();
  if(provider) return provider.charAt(0).toUpperCase()+provider.slice(1)+' Subscription';
  return subject.split('|')[0].split('-')[0].trim();
}

/* ===== Google Calendar integration ===== */
function getStoredCalId(){ return localStorage.getItem('gcal.calendarId') || null; }
function setStoredCalId(id){ localStorage.setItem('gcal.calendarId', id); }

async function ensureGCalToken(){
  if(gcalAccessToken) return;
  await gcalTokenClient?.requestAccessToken({prompt:''});
  if(!gcalAccessToken) throw new Error('Chưa kết nối Calendar');
}

async function ensureCalendarId(){
  await ensureGCalToken();
  const headers = {Authorization:'Bearer '+gcalAccessToken,'Content-Type':'application/json'};
  let calId = getStoredCalId();
  if(calId){
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`, {headers});
    if(res.ok) return calId;
  }
  const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner', {headers});
  const listData = await listRes.json();
  const found = (listData.items||[]).find(c=> (c.summary||'') === GCAL_CAL_SUMMARY);
  if(found){ setStoredCalId(found.id); return found.id; }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method:'POST', headers, body: JSON.stringify({summary: GCAL_CAL_SUMMARY, timeZone: tz})
  });
  const created = await createRes.json();
  if(!createRes.ok) throw new Error('Không tạo được Calendar: '+(created.error?.message||createRes.status));
  setStoredCalId(created.id);
  return created.id;
}

function toISODateOnly(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function rruleForItem(it){
  if(it.cycle==='weekly') return 'RRULE:FREQ=WEEKLY';
  if(it.cycle==='monthly') return 'RRULE:FREQ=MONTHLY';
  if(it.cycle==='yearly') return 'RRULE:FREQ=YEARLY';
  const n = Math.max(1, Number(it.customDays||30));
  return `RRULE:FREQ=DAILY;INTERVAL=${n}`;
}
function buildEventFor(it){
  const next = nextRenewal(it.startDate, it.cycle, it.customDays);
  const start = next ? toISODateOnly(next) : toISODateOnly(new Date());
  const end   = toISODateOnly(addDays(new Date(start),1)); // all-day
  const remindMin = Math.max(0, Number(it.remindBefore||7)) * 1440;
  return {
    summary: `Gia hạn: ${it.name}`,
    description: `Nhà cung cấp: ${it.provider||''}\nGiá/kỳ: ${it.price||''} ${it.currency||''}\nChu kỳ: ${cycleLabel(it.cycle,it.customDays)}\nGhi chú: ${it.notes||''}`,
    start: { date: start },
    end:   { date: end   },
    recurrence: [ rruleForItem(it) ],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: remindMin }] }
  };
}
async function gcalUpsertEvent(calendarId, it){
  const headers = {Authorization:'Bearer '+gcalAccessToken,'Content-Type':'application/json'};
  const body = buildEventFor(it);
  if(it.gcalEventId){
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(it.gcalEventId)}`, {
      method:'PATCH', headers, body: JSON.stringify(body)
    });
    if(res.ok){ const ev = await res.json(); return {eventId: ev.id}; }
  }
  const ins = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method:'POST', headers, body: JSON.stringify(body)
  });
  if(!ins.ok){ const err=await ins.json().catch(()=>({})); throw new Error('Calendar insert fail: '+(err.error?.message||ins.status)); }
  const ev = await ins.json();
  return {eventId: ev.id};
}
async function gcalDeleteEvent(calendarId, eventId){
  try{
    await ensureGCalToken();
    const headers = {Authorization:'Bearer '+gcalAccessToken};
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method:'DELETE', headers
    });
  }catch(e){ console.warn('gcalDeleteEvent', e); }
}
async function syncItemToCalendar(it){
  try{
    await ensureGCalToken();
    const calId = await ensureCalendarId();
    const {eventId} = await gcalUpsertEvent(calId, it);
    return { gcalEventId: eventId, gcalCalendarId: calId };
  }catch(e){
    console.warn('syncItemToCalendar failed', e);
    return null;
  }
}