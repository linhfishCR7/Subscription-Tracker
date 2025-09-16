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

/* ===== ENHANCED FILTERING & SEARCH ===== */
let selectedItems = new Set();
let bulkModeActive = false;

function getActiveFilters() {
  return {
    search: $('#search')?.value?.toLowerCase() || '',
    status: $('#filterStatus')?.value || 'all',
    price: $('#filterPrice')?.value || 'all',
    cycle: $('#filterCycle')?.value || 'all',
    due: $('#filterDue')?.value || 'all',
    quickFilters: Array.from(document.querySelectorAll('.quick-filter-tag.active')).map(el => el.dataset.filter)
  };
}

function applyFilters(list, filters) {
  let filtered = [...list];

  // Search filter with highlighting
  if (filters.search) {
    filtered = filtered.filter(item => {
      const searchText = [item.name, item.provider, (item.tags || []).join(',')].join(' ').toLowerCase();
      return searchText.includes(filters.search);
    });
  }

  // Status filter
  if (filters.status !== 'all') {
    filtered = filtered.filter(item => (item.status || 'active') === filters.status);
  }

  // Price range filter
  if (filters.price !== 'all') {
    const [min, max] = filters.price.split('-').map(v => v === '+' ? Infinity : parseFloat(v));
    filtered = filtered.filter(item => {
      const price = item.price || 0;
      return max === undefined ? price >= min : price >= min && price <= max;
    });
  }

  // Cycle filter
  if (filters.cycle !== 'all') {
    filtered = filtered.filter(item => item.cycle === filters.cycle);
  }

  // Due date filter
  if (filters.due !== 'all') {
    const today = new Date();
    filtered = filtered.filter(item => {
      if (!item.next) return false;
      const days = daysBetween(today, item.next);

      switch (filters.due) {
        case 'overdue': return days < 0;
        case 'week': return days >= 0 && days <= 7;
        case 'month': return days >= 0 && days <= 30;
        default: return true;
      }
    });
  }

  // Quick filters
  filters.quickFilters.forEach(filter => {
    switch (filter) {
      case 'expensive':
        filtered = filtered.filter(item => (item.price || 0) > 50);
        break;
      case 'due-soon':
        filtered = filtered.filter(item => {
          if (!item.next) return false;
          const days = daysBetween(new Date(), item.next);
          return days >= 0 && days <= 7;
        });
        break;
      case 'entertainment':
        filtered = filtered.filter(item => {
          const tags = (item.tags || []).join(' ').toLowerCase();
          const name = (item.name || '').toLowerCase();
          return tags.includes('entertainment') || name.includes('netflix') || name.includes('spotify') || name.includes('youtube');
        });
        break;
      case 'productivity':
        filtered = filtered.filter(item => {
          const tags = (item.tags || []).join(' ').toLowerCase();
          const name = (item.name || '').toLowerCase();
          return tags.includes('productivity') || name.includes('office') || name.includes('adobe') || name.includes('google');
        });
        break;
    }
  });

  return filtered;
}

/* ===== ENHANCED UI RENDER ===== */
function render(){
  const filters = getActiveFilters();
  let list = loadLocal();

  // Calculate next renewal and progress for all items
  list.forEach(item => {
    item.next = nextRenewal(item.startDate, item.cycle, item.customDays);
    item.daysLeft = item.next ? daysBetween(new Date(), item.next) : null;
    item.progress = pctProgress(item.startDate, item.next, item.cycle, item.customDays);
  });

  // Apply all filters
  const filteredList = applyFilters(list, filters);

  // Update analytics dashboard with error handling
  try {
    updateAnalyticsDashboard(list);
  } catch (error) {
    console.error('Error updating analytics dashboard:', error);
    // Continue with other rendering tasks
  }

  // Render table or cards based on view mode
  const viewMode = document.querySelector('.view-toggle.active')?.dataset.view || 'table';
  if (viewMode === 'table') {
    renderTable(filteredList, filters.search);
  } else {
    renderCards(filteredList, filters.search);
  }

  // Update summary stats
  updateSummaryStats(filteredList, list);

  // Update bulk operations panel
  updateBulkPanel();
}

function renderTable(list, searchTerm = '') {
  const by = $('#sortBy')?.value || 'next';
  const dir = $('#sortDir')?.value || 'asc';

  // Sort the list
  list.sort((a, b) => {
    const s = v => v == null ? -Infinity : v;
    if (by === 'name') return (a.name || '').localeCompare(b.name || '') * (dir === 'asc' ? 1 : -1);
    if (by === 'provider') return (a.provider || '').localeCompare(b.provider || '') * (dir === 'asc' ? 1 : -1);
    if (by === 'price') return ((a.price || 0) - (b.price || 0)) * (dir === 'asc' ? 1 : -1);
    return ((s(a.next?.getTime()) - s(b.next?.getTime()))) * (dir === 'asc' ? 1 : -1);
  });

  const tbody = $('#table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="no-results"><p>No subscriptions found matching your criteria.</p></td></tr>';
    return;
  }

  list.forEach(item => {
    const days = item.daysLeft;
    const pill = days == null ? '<span class="pill">—</span>' :
      days < 0 ? `<span class="pill due">Overdue ${Math.abs(days)} days</span>` :
      days === 0 ? '<span class="pill due">Today</span>' :
      days <= Number(item.remindBefore || 7) ? `<span class="pill soon">${days} days left</span>` :
      `<span class="pill ok">${days} days</span>`;

    const tr = document.createElement('tr');
    tr.className = selectedItems.has(item.id) ? 'subscription-row selected' : 'subscription-row';

    // Highlight search terms
    const highlightText = (text, term) => {
      if (!term || !text) return esc(text || '');
      const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return esc(text).replace(regex, '<mark>$1</mark>');
    };

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="subscription-checkbox"
               ${selectedItems.has(item.id) ? 'checked' : ''}
               onchange="toggleItemSelection('${item.id}', this.checked)">
      </td>
      <td>
        <div style="font-weight:700">${highlightText(item.name, searchTerm)}</div>
        <div class="small muted">${highlightText(item.notes, searchTerm)}</div>
      </td>
      <td>${highlightText(item.provider, searchTerm)}</td>
      <td>${fmtMoney(item.price, item.currency)}</td>
      <td>
        ${cycleLabel(item.cycle, item.customDays)}
        <div class="small muted">${esc(item.status || 'active')}</div>
      </td>
      <td style="min-width:150px">
        <div class="progress-modern">
          <div class="progress-modern__fill" style="width:${item.progress}%"></div>
        </div>
        <div class="small muted">${item.progress}%</div>
      </td>
      <td>${item.next ? new Date(item.next).toLocaleDateString() : '—'}</td>
      <td>${pill}</td>
      <td>${(item.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td class="nowrap">
        <button class="btn-outline btn-small" onclick="editItem('${item.id}')" aria-label="Edit ${esc(item.name)}">
          <span class="feature-icon">✏️</span>
        </button>
        <button class="btn-danger btn-small" onclick="delItem('${item.id}')" aria-label="Delete ${esc(item.name)}">
          <span class="feature-icon">🗑️</span>
        </button>
        <button class="btn-outline btn-small" onclick="downloadICSFor('${item.id}')" aria-label="Export calendar for ${esc(item.name)}">
          <span class="feature-icon">📅</span>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderCards(list, searchTerm = '') {
  const container = $('#subscriptions-cards');
  if (!container) return;

  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="no-results"><p>No subscriptions found matching your criteria.</p></div>';
    return;
  }

  list.forEach(item => {
    const days = item.daysLeft;
    const statusClass = days == null ? 'unknown' :
      days < 0 ? 'overdue' :
      days === 0 ? 'due-today' :
      days <= Number(item.remindBefore || 7) ? 'due-soon' : 'ok';

    const card = document.createElement('div');
    card.className = `subscription-card ${selectedItems.has(item.id) ? 'selected' : ''}`;

    const highlightText = (text, term) => {
      if (!term || !text) return esc(text || '');
      const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return esc(text).replace(regex, '<mark>$1</mark>');
    };

    card.innerHTML = `
      <div class="card-header">
        <input type="checkbox" class="subscription-checkbox"
               ${selectedItems.has(item.id) ? 'checked' : ''}
               onchange="toggleItemSelection('${item.id}', this.checked)">
        <h4>${highlightText(item.name, searchTerm)}</h4>
        <div class="card-price">${fmtMoney(item.price, item.currency)}</div>
      </div>
      <div class="card-body">
        <div class="card-provider">${highlightText(item.provider, searchTerm)}</div>
        <div class="card-cycle">${cycleLabel(item.cycle, item.customDays)}</div>
        <div class="progress-modern">
          <div class="progress-modern__fill" style="width:${item.progress}%"></div>
        </div>
        <div class="card-due ${statusClass}">
          ${days == null ? 'No due date' :
            days < 0 ? `Overdue ${Math.abs(days)} days` :
            days === 0 ? 'Due today' :
            `${days} days left`}
        </div>
        ${item.tags && item.tags.length > 0 ? `
          <div class="card-tags">
            ${item.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="card-actions">
        <button class="btn-outline btn-small" onclick="editItem('${item.id}')" aria-label="Edit ${esc(item.name)}">
          <span class="feature-icon">✏️</span>
        </button>
        <button class="btn-danger btn-small" onclick="delItem('${item.id}')" aria-label="Delete ${esc(item.name)}">
          <span class="feature-icon">🗑️</span>
        </button>
        <button class="btn-outline btn-small" onclick="downloadICSFor('${item.id}')" aria-label="Export calendar for ${esc(item.name)}">
          <span class="feature-icon">📅</span>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function esc(s){return (s||'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}

/* ===== ANALYTICS DASHBOARD ===== */
function updateAnalyticsDashboard(list) {
  if (!Array.isArray(list)) {
    console.warn('Invalid list provided to updateAnalyticsDashboard');
    return;
  }

  const activeSubscriptions = list.filter(item => (item.status || 'active') === 'active');
  const totalActive = activeSubscriptions.length;

  // Calculate monthly spending
  let totalMonthly = 0;
  let totalYearly = 0;

  activeSubscriptions.forEach(item => {
    const price = Number(item.price || 0);
    const factor = item.cycle === 'weekly' ? 4.345 :
                   item.cycle === 'yearly' ? 1/12 :
                   item.cycle === 'custom' ? (30 / (Number(item.customDays || 30))) : 1;
    totalMonthly += price * factor;
    totalYearly += price * factor * 12;
  });

  // Calculate due dates
  const today = new Date();
  const dueSoon = activeSubscriptions.filter(item => {
    if (!item.next) return false;
    const days = daysBetween(today, item.next);
    return days >= 0 && days <= 7;
  }).length;

  const overdue = activeSubscriptions.filter(item => {
    if (!item.next) return false;
    const days = daysBetween(today, item.next);
    return days < 0;
  }).length;

  // Update metric cards
  updateMetricCard('totalSubscriptions', totalActive, 'Active Subscriptions');
  updateMetricCard('monthlySpending', fmtMoney(totalMonthly, 'VND'), 'Monthly Spending');
  updateMetricCard('yearlySpending', fmtMoney(totalYearly, 'VND'), 'Yearly Spending');
  updateMetricCard('dueSoon', dueSoon, 'Due This Week');
  updateMetricCard('overdue', overdue, 'Overdue');

  // Update charts with error handling
  try {
    updateSpendingChart(activeSubscriptions);
  } catch (error) {
    console.error('Failed to update spending chart:', error);
  }

  try {
    updateCategoryChart(activeSubscriptions);
  } catch (error) {
    console.error('Failed to update category chart:', error);
  }
}

function updateMetricCard(id, value, label) {
  const card = document.querySelector(`[data-metric="${id}"]`);
  if (!card) return;

  const valueEl = card.querySelector('.metric-value');
  const labelEl = card.querySelector('.metric-label');

  if (valueEl) valueEl.textContent = value;
  if (labelEl) labelEl.textContent = label;

  // Add animation class
  card.classList.add('metric-updated');
  setTimeout(() => card.classList.remove('metric-updated'), 300);
}

function updateSummaryStats(filteredList, allList) {
  const summaryEl = document.getElementById('summaryStats');
  if (!summaryEl) return;

  const totalActive = allList.filter(item => (item.status || 'active') === 'active').length;
  let totalMonthly = 0;

  allList.forEach(item => {
    if ((item.status || 'active') === 'active') {
      const factor = item.cycle === 'weekly' ? 4.345 :
                     item.cycle === 'yearly' ? 1/12 :
                     item.cycle === 'custom' ? (30 / (Number(item.customDays || 30))) : 1;
      totalMonthly += Number(item.price || 0) * factor;
    }
  });

  summaryEl.textContent = `Showing ${filteredList.length} of ${allList.length} subscriptions | Active: ${totalActive} | Monthly: ${fmtMoney(totalMonthly, 'VND')}`;
}

/* ===== BULK OPERATIONS ===== */
function toggleItemSelection(itemId, selected) {
  if (selected) {
    selectedItems.add(itemId);
  } else {
    selectedItems.delete(itemId);
  }
  updateBulkPanel();
  updateSelectionUI();
}

function toggleSelectAll() {
  const allCheckboxes = document.querySelectorAll('.subscription-checkbox');
  const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);

  allCheckboxes.forEach(checkbox => {
    checkbox.checked = !allChecked;
    const itemId = checkbox.getAttribute('onchange')?.match(/'([^']+)'/)?.[1];
    if (itemId) {
      toggleItemSelection(itemId, checkbox.checked);
    }
  });
}

function updateBulkPanel() {
  const bulkPanel = document.getElementById('bulkPanel');
  const bulkCount = document.getElementById('bulkCount');

  if (!bulkPanel || !bulkCount) return;

  const selectedCount = selectedItems.size;

  if (selectedCount > 0) {
    bulkPanel.style.display = 'block';
    bulkCount.textContent = selectedCount;
    bulkModeActive = true;
  } else {
    bulkPanel.style.display = 'none';
    bulkModeActive = false;
  }
}

function updateSelectionUI() {
  // Update row/card selection styles
  document.querySelectorAll('.subscription-row, .subscription-card').forEach(element => {
    const checkbox = element.querySelector('.subscription-checkbox');
    if (checkbox && checkbox.checked) {
      element.classList.add('selected');
    } else {
      element.classList.remove('selected');
    }
  });
}

function clearSelection() {
  selectedItems.clear();
  document.querySelectorAll('.subscription-checkbox').forEach(cb => cb.checked = false);
  updateBulkPanel();
  updateSelectionUI();
}

async function bulkEdit() {
  if (selectedItems.size === 0) return;

  const confirmed = await modal.show(
    'Bulk Edit Subscriptions',
    `Edit ${selectedItems.size} selected subscriptions?`,
    'Edit',
    'btn-primary'
  );

  if (!confirmed) return;

  // Show bulk edit modal (simplified - could be expanded)
  notifications.show(`Bulk edit feature coming soon for ${selectedItems.size} items`, 'info', 3000);
}

async function bulkPause() {
  if (selectedItems.size === 0) return;

  const confirmed = await modal.show(
    'Pause Subscriptions',
    `Pause ${selectedItems.size} selected subscriptions?`,
    'Pause',
    'btn-warning'
  );

  if (!confirmed) return;

  loading.show('Pausing subscriptions...');

  try {
    const list = loadLocal();
    let updated = false;

    list.forEach(item => {
      if (selectedItems.has(item.id)) {
        item.status = 'paused';
        updated = true;
      }
    });

    if (updated) {
      saveLocal(list);

      // Sync to Firestore
      for (const itemId of selectedItems) {
        const item = list.find(x => x.id === itemId);
        if (item) {
          await upsertToFirestore(item);
        }
      }

      render();
      clearSelection();
      notifications.show(`Successfully paused ${selectedItems.size} subscriptions`, 'success', 3000);
    }
  } catch (error) {
    console.error('Bulk pause error:', error);
    notifications.show('Failed to pause some subscriptions', 'error', 5000);
  } finally {
    loading.hide();
  }
}

async function bulkResume() {
  if (selectedItems.size === 0) return;

  const confirmed = await modal.show(
    'Resume Subscriptions',
    `Resume ${selectedItems.size} selected subscriptions?`,
    'Resume',
    'btn-success'
  );

  if (!confirmed) return;

  loading.show('Resuming subscriptions...');

  try {
    const list = loadLocal();
    let updated = false;

    list.forEach(item => {
      if (selectedItems.has(item.id)) {
        item.status = 'active';
        updated = true;
      }
    });

    if (updated) {
      saveLocal(list);

      // Sync to Firestore
      for (const itemId of selectedItems) {
        const item = list.find(x => x.id === itemId);
        if (item) {
          await upsertToFirestore(item);
        }
      }

      render();
      clearSelection();
      notifications.show(`Successfully resumed ${selectedItems.size} subscriptions`, 'success', 3000);
    }
  } catch (error) {
    console.error('Bulk resume error:', error);
    notifications.show('Failed to resume some subscriptions', 'error', 5000);
  } finally {
    loading.hide();
  }
}

async function bulkDelete() {
  if (selectedItems.size === 0) return;

  const confirmed = await modal.show(
    'Delete Subscriptions',
    `Permanently delete ${selectedItems.size} selected subscriptions? This action cannot be undone.`,
    'Delete',
    'btn-danger'
  );

  if (!confirmed) return;

  loading.show('Deleting subscriptions...');

  try {
    const list = loadLocal();
    const itemsToDelete = Array.from(selectedItems);

    // Remove from local storage
    const updatedList = list.filter(item => !selectedItems.has(item.id));
    saveLocal(updatedList);

    // Remove from Firestore
    for (const itemId of itemsToDelete) {
      await deleteFromFirestore(itemId);
    }

    render();
    clearSelection();
    notifications.show(`Successfully deleted ${itemsToDelete.length} subscriptions`, 'success', 3000);
  } catch (error) {
    console.error('Bulk delete error:', error);
    notifications.show('Failed to delete some subscriptions', 'error', 5000);
  } finally {
    loading.hide();
  }
}

/* ===== CHART FUNCTIONS ===== */
function updateSpendingChart(subscriptions) {
  const canvas = document.getElementById('spendingChart');
  if (!canvas) {
    console.warn('Spending chart canvas element not found');
    return;
  }

  // Verify it's actually a canvas element
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.warn('Element with ID "spendingChart" is not a canvas element');
    return;
  }

  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Could not get 2D context from spending chart canvas');
      return;
    }

    const width = canvas.width = canvas.offsetWidth * 2; // Retina support
    const height = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    // Generate last 6 months data
    const months = [];
    const data = [];
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push(date.toLocaleDateString('en', { month: 'short' }));

      // Calculate spending for this month (simplified)
      let monthlyTotal = 0;
      subscriptions.forEach(sub => {
        const price = Number(sub.price || 0);
        const factor = sub.cycle === 'weekly' ? 4.345 :
                       sub.cycle === 'yearly' ? 1/12 :
                       sub.cycle === 'custom' ? (30 / (Number(sub.customDays || 30))) : 1;
        monthlyTotal += price * factor;
      });
      data.push(monthlyTotal);
    }

    // Simple line chart
    drawLineChart(ctx, data, months, width/2, height/2);
  } catch (error) {
    console.error('Error updating spending chart:', error);
  }
}

function drawLineChart(ctx, data, labels, width, height) {
  if (!ctx || !data || data.length === 0) {
    console.warn('Invalid parameters for drawLineChart');
    return;
  }

  try {
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxValue = Math.max(...data) * 1.1;
    const minValue = Math.min(...data) * 0.9;
    const range = maxValue - minValue || 1;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#2a2f3a';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = padding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw line
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 3;
    ctx.beginPath();

    data.forEach((value, index) => {
      const x = padding + (chartWidth / (data.length - 1)) * index;
      const y = padding + chartHeight - ((value - minValue) / range) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw points
    ctx.fillStyle = '#4f46e5';
    data.forEach((value, index) => {
      const x = padding + (chartWidth / (data.length - 1)) * index;
      const y = padding + chartHeight - ((value - minValue) / range) * chartHeight;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  } catch (error) {
    console.error('Error drawing line chart:', error);
  }
}

function updateCategoryChart(subscriptions) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) {
    console.warn('Category chart canvas element not found');
    return;
  }

  // Verify it's actually a canvas element
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.warn('Element with ID "categoryChart" is not a canvas element');
    return;
  }

  try {
    // Simple category breakdown
    const categories = {};
    subscriptions.forEach(sub => {
      const tags = sub.tags || [];
      if (tags.length === 0) {
        categories['Other'] = (categories['Other'] || 0) + (sub.price || 0);
      } else {
        tags.forEach(tag => {
          categories[tag] = (categories[tag] || 0) + (sub.price || 0);
        });
      }
    });

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Could not get 2D context from category chart canvas');
      return;
    }

    const width = canvas.width = canvas.offsetWidth * 2;
    const height = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    drawPieChart(ctx, categories, width/2, height/2);
  } catch (error) {
    console.error('Error updating category chart:', error);
  }
}

function drawPieChart(ctx, data, width, height) {
  if (!ctx || !data || typeof data !== 'object') {
    console.warn('Invalid parameters for drawPieChart');
    return;
  }

  try {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 20;

    const total = Object.values(data).reduce((sum, val) => sum + val, 0);
    if (total === 0) {
      // Draw empty state
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#2a2f3a';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', centerX, centerY);
      return;
    }

    const colors = ['#4f46e5', '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

    ctx.clearRect(0, 0, width, height);

    let currentAngle = -Math.PI / 2;
    Object.entries(data).forEach(([, value], index) => {
      const sliceAngle = (value / total) * Math.PI * 2;

      ctx.fillStyle = colors[index % colors.length];
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
      ctx.closePath();
      ctx.fill();

      currentAngle += sliceAngle;
    });
  } catch (error) {
    console.error('Error drawing pie chart:', error);
  }
}

/* ===== EXPORT FUNCTIONS ===== */
async function exportCSV() {
  loading.show('Generating CSV export...');

  try {
    const list = loadLocal();
    const includeInactive = document.getElementById('includeInactive')?.checked || false;
    const includeTags = document.getElementById('includeTags')?.checked || false;

    const filteredList = includeInactive ? list : list.filter(item => (item.status || 'active') === 'active');

    // CSV headers
    let headers = ['Name', 'Provider', 'Price', 'Currency', 'Cycle', 'Start Date', 'Next Renewal', 'Status'];
    if (includeTags) {
      headers.push('Tags', 'Notes');
    }

    // CSV rows
    const rows = [headers];
    filteredList.forEach(item => {
      item.next = nextRenewal(item.startDate, item.cycle, item.customDays);

      let row = [
        item.name || '',
        item.provider || '',
        item.price || 0,
        item.currency || 'VND',
        cycleLabel(item.cycle, item.customDays),
        item.startDate ? new Date(item.startDate).toLocaleDateString() : '',
        item.next ? new Date(item.next).toLocaleDateString() : '',
        item.status || 'active'
      ];

      if (includeTags) {
        row.push((item.tags || []).join(', '), item.notes || '');
      }

      rows.push(row);
    });

    // Convert to CSV
    const csvContent = rows.map(row =>
      row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Download
    downloadFile(csvContent, 'subscriptions.csv', 'text/csv');
    notifications.show('CSV export completed successfully', 'success', 3000);
  } catch (error) {
    console.error('CSV export error:', error);
    notifications.show('Failed to export CSV', 'error', 5000);
  } finally {
    loading.hide();
  }
}

async function exportPDF() {
  loading.show('Generating PDF report...');

  try {
    const list = loadLocal();
    const includeInactive = document.getElementById('includeInactive')?.checked || false;
    const filteredList = includeInactive ? list : list.filter(item => (item.status || 'active') === 'active');

    // Calculate analytics
    let totalMonthly = 0;
    let totalYearly = 0;
    const activeCount = filteredList.filter(item => (item.status || 'active') === 'active').length;

    filteredList.forEach(item => {
      if ((item.status || 'active') === 'active') {
        const price = Number(item.price || 0);
        const factor = item.cycle === 'weekly' ? 4.345 :
                       item.cycle === 'yearly' ? 1/12 :
                       item.cycle === 'custom' ? (30 / (Number(item.customDays || 30))) : 1;
        totalMonthly += price * factor;
        totalYearly += price * factor * 12;
      }
    });

    // Generate HTML report
    const reportHTML = generatePDFReport(filteredList, {
      totalSubscriptions: filteredList.length,
      activeSubscriptions: activeCount,
      monthlySpending: totalMonthly,
      yearlySpending: totalYearly
    });

    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(reportHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();

    notifications.show('PDF report generated successfully', 'success', 3000);
  } catch (error) {
    console.error('PDF export error:', error);
    notifications.show('Failed to generate PDF report', 'error', 5000);
  } finally {
    loading.hide();
  }
}

function generatePDFReport(subscriptions, analytics) {
  const today = new Date().toLocaleDateString();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Subscription Tracker Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .analytics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px; }
        .metric { padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #4f46e5; }
        .metric-label { color: #666; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .status-active { color: #10b981; }
        .status-paused { color: #f59e0b; }
        .status-cancelled { color: #ef4444; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Subscription Tracker Report</h1>
        <p>Generated on ${today}</p>
      </div>

      <div class="analytics">
        <div class="metric">
          <div class="metric-value">${analytics.totalSubscriptions}</div>
          <div class="metric-label">Total Subscriptions</div>
        </div>
        <div class="metric">
          <div class="metric-value">${analytics.activeSubscriptions}</div>
          <div class="metric-label">Active Subscriptions</div>
        </div>
        <div class="metric">
          <div class="metric-value">${fmtMoney(analytics.monthlySpending, 'VND')}</div>
          <div class="metric-label">Monthly Spending</div>
        </div>
        <div class="metric">
          <div class="metric-value">${fmtMoney(analytics.yearlySpending, 'VND')}</div>
          <div class="metric-label">Yearly Spending</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Price</th>
            <th>Cycle</th>
            <th>Next Renewal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${subscriptions.map(item => {
            item.next = nextRenewal(item.startDate, item.cycle, item.customDays);
            return `
              <tr>
                <td>${esc(item.name || '')}</td>
                <td>${esc(item.provider || '')}</td>
                <td>${fmtMoney(item.price, item.currency)}</td>
                <td>${cycleLabel(item.cycle, item.customDays)}</td>
                <td>${item.next ? new Date(item.next).toLocaleDateString() : '—'}</td>
                <td class="status-${item.status || 'active'}">${item.status || 'active'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

/* ===== ENHANCED EVENT LISTENERS ===== */
document.addEventListener('DOMContentLoaded', async () => {
  setSupportNote();
  render();

  // Enhanced search and filtering
  $('#search')?.addEventListener('input', render);
  $('#filterStatus')?.addEventListener('change', render);
  $('#filterPrice')?.addEventListener('change', render);
  $('#filterCycle')?.addEventListener('change', render);
  $('#filterDue')?.addEventListener('change', render);
  $('#sortBy')?.addEventListener('change', render);
  $('#sortDir')?.addEventListener('change', render);

  // View toggle buttons
  document.querySelectorAll('.view-toggle').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      const viewMode = this.dataset.view;
      const tableContainer = document.getElementById('table-container');
      const cardsContainer = document.getElementById('subscriptions-cards');

      if (viewMode === 'table') {
        if (tableContainer) tableContainer.style.display = 'block';
        if (cardsContainer) cardsContainer.style.display = 'none';
      } else {
        if (tableContainer) tableContainer.style.display = 'none';
        if (cardsContainer) cardsContainer.style.display = 'grid';
      }

      render();
    });
  });

  // Bulk operations
  document.getElementById('selectAll')?.addEventListener('click', toggleSelectAll);
  document.getElementById('bulkEdit')?.addEventListener('click', bulkEdit);
  document.getElementById('bulkPause')?.addEventListener('click', bulkPause);
  document.getElementById('bulkResume')?.addEventListener('click', bulkResume);
  document.getElementById('bulkDelete')?.addEventListener('click', bulkDelete);

  // Enhanced export functions
  document.getElementById('exportCSV')?.addEventListener('click', exportCSV);
  document.getElementById('exportPDF')?.addEventListener('click', exportPDF);
  document.getElementById('generateReport')?.addEventListener('click', () => {
    notifications.show('Advanced reporting feature coming soon!', 'info', 3000);
  });

  // Quick filter tags
  document.querySelectorAll('.quick-filter-tag').forEach(tag => {
    tag.addEventListener('click', function() {
      this.classList.toggle('active');
      render();
    });
  });

  // Authentication state changes
  auth.onAuthStateChanged(async user => {
    if (user) {
      $('#btnLogin')?.classList.add('hidden');
      $('#btnLogout')?.classList.remove('hidden');
      $('#btnGmail')?.classList.remove('hidden');
      $('#btnCalendar')?.classList.remove('hidden');
      const userInfo = $('#userInfo');
      if (userInfo) {
        userInfo.innerHTML = `<div class="small muted">Signed in: ${user.email}</div>`;
      }
      await syncFromFirestore();
      notifications.show('Successfully signed in!', 'success', 3000);
    } else {
      $('#btnLogin')?.classList.remove('hidden');
      $('#btnLogout')?.classList.add('hidden');
      $('#btnGmail')?.classList.add('hidden');
      $('#btnCalendar')?.classList.add('hidden');
      const userInfo = $('#userInfo');
      if (userInfo) {
        userInfo.innerHTML = '';
      }
    }
  });

  // Initialize charts after a short delay to ensure elements are rendered
  setTimeout(() => {
    try {
      const list = loadLocal();
      if (list.length > 0) {
        updateAnalyticsDashboard(list);
      } else {
        // Initialize empty charts
        console.log('No subscription data found, initializing empty charts');
        updateAnalyticsDashboard([]);
      }
    } catch (error) {
      console.error('Error initializing analytics dashboard:', error);
    }
  }, 1000); // Increased delay to ensure DOM is fully ready
});

// Enhanced delete confirmation
window.delItem = async function(id) {
  const item = loadLocal().find(x => x.id === id);
  if (!item) return;

  const confirmed = await modal.show(
    'Delete Subscription',
    `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
    'Delete',
    'btn-danger'
  );

  if (!confirmed) return;

  loading.show('Deleting subscription...');

  try {
    const list = loadLocal().filter(x => x.id !== id);
    saveLocal(list);
    render();

    await deleteFromFirestore(id);

    if (gcalAccessToken && item?.gcalCalendarId && item?.gcalEventId) {
      await gcalDeleteEvent(item.gcalCalendarId, item.gcalEventId);
    }

    notifications.show(`"${item.name}" deleted successfully`, 'success', 3000);
  } catch (error) {
    console.error('Delete error:', error);
    notifications.show('Failed to delete subscription', 'error', 5000);
  } finally {
    loading.hide();
  }
};

// Make functions globally available
window.toggleItemSelection = toggleItemSelection;
window.toggleSelectAll = toggleSelectAll;
window.bulkEdit = bulkEdit;
window.bulkPause = bulkPause;
window.bulkResume = bulkResume;
window.bulkDelete = bulkDelete;
window.exportCSV = exportCSV;
window.exportPDF = exportPDF;