const REFRESH_MS = 5000;
const GROUP_PALETTE = [
  '#1e88e5', '#43a047', '#fb8c00', '#8e24aa',
  '#e53935', '#00897b', '#fdd835', '#6d4c41',
];
const WAITING_COLOR = '#757575';
const CAMPUS_COLOR = '#d81b60';
const CAMPUS_NAMES = { mirzo_ulugbek: 'Mirzo Ulugbek', yashnobod: 'Yashnobod' };
const DEFAULT_CENTER = [41.3111, 69.2797];

function campusName(id) {
  return CAMPUS_NAMES[id] || id;
}

/** HTML-escape untrusted strings (displayName comes from Telegram). */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- token handling ---------------------------------------------------------
let token = localStorage.getItem('adminToken') || '';

function updateTokenStatus() {
  document.getElementById('token-status').textContent = token ? '🔓 токен задан' : '';
}

function authHeaders() {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function promptToken() {
  const t = window.prompt('Введите токен администратора (ADMIN_TOKEN):', token || '');
  if (t === null) return false;
  token = t.trim();
  localStorage.setItem('adminToken', token);
  updateTokenStatus();
  return true;
}

// ---- map --------------------------------------------------------------------
const map = L.map('map', { preferCanvas: true }).setView(DEFAULT_CENTER, 11);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let tileErrors = 0, switched = false;
osm.on('tileerror', () => {
  if (switched || ++tileErrors < 4) return;
  switched = true;
  map.removeLayer(osm);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
});

const layer = L.featureGroup().addTo(map);
let fitted = false;

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function groupColor(index) {
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

// ---- filters ----------------------------------------------------------------
const filters = { status: 'all', campus: 'all', language: 'all', query: '' };
let lastState = null;

function applyFilters(participants) {
  const q = filters.query.trim().toLowerCase();
  return participants.filter((p) => {
    if (filters.status !== 'all' && p.status !== filters.status) return false;
    if (filters.campus !== 'all' && p.campusId !== filters.campus) return false;
    if (filters.language !== 'all' && p.language !== filters.language) return false;
    if (q) {
      const hay = (String(p.displayName || '') + ' ' + String(p.phone || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Populate campus + language dropdowns from the state (once values appear). */
function syncFilterOptions(state) {
  const campusSel = document.getElementById('f-campus');
  const langSel = document.getElementById('f-language');

  const campusIds = Array.from(new Set(state.participants.map((p) => p.campusId))).filter(Boolean);
  syncSelect(campusSel, campusIds, (id) => campusName(id));

  const langs = Array.from(new Set(state.participants.map((p) => p.language))).filter(Boolean);
  syncSelect(langSel, langs, (l) => l);
}

function syncSelect(select, values, labelFn) {
  const have = new Set(Array.from(select.options).map((o) => o.value));
  for (const v of values) {
    if (have.has(v)) continue;
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn(v);
    select.appendChild(opt);
  }
}

// ---- rendering --------------------------------------------------------------
function render(state) {
  lastState = state;
  syncFilterOptions(state);

  const filtered = applyFilters(state.participants);
  const byId = {};
  for (const p of state.participants) byId[p.id] = p;
  const groups = state.groups || [];
  const groupIndex = {};
  groups.forEach((g, i) => { groupIndex[g.groupId] = i; });

  // metrics
  document.getElementById('m-total').textContent = String(filtered.length);
  document.getElementById('m-grouped').textContent =
    String(filtered.filter((p) => p.status === 'grouped').length);
  document.getElementById('m-waiting').textContent =
    String(filtered.filter((p) => p.status === 'waiting').length);
  document.getElementById('m-groups').textContent = String(groups.length);
  document.getElementById('m-tickets').textContent = String((state.supportTickets || []).length);

  // map
  layer.clearLayers();
  const allLatLngs = [];

  for (const c of (state.campuses || [])) {
    L.marker([c.lat, c.lng], {
      icon: L.divIcon({
        className: 'campus-icon',
        html: '<div class="campus-icon" style="width:26px;height:26px;background:' + CAMPUS_COLOR + '">★</div>',
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    }).addTo(layer).bindPopup('<b>' + esc(campusName(c.id)) + '</b><br>кампус');
  }

  const centroidsDrawn = new Set();
  for (const p of filtered) {
    allLatLngs.push([p.lat, p.lng]);
    const gi = p.groupId != null ? groupIndex[p.groupId] : undefined;
    const color = gi !== undefined ? groupColor(gi) : WAITING_COLOR;
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95
    }).addTo(layer).bindPopup(
      '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
      '<br>📞 ' + esc(p.phone) +
      '<br>🏫 ' + esc(campusName(p.campusId)) +
      '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
      (p.groupId ? '<br>Группа: ' + esc(p.groupId) : '<br><i>в очереди</i>')
    );
    if (gi !== undefined) {
      const g = groups[gi];
      L.polyline([[g.centroid.lat, g.centroid.lng], [p.lat, p.lng]], {
        color, weight: 1.5, opacity: 0.6, dashArray: '4 4'
      }).addTo(layer);
      if (!centroidsDrawn.has(p.groupId)) {
        centroidsDrawn.add(p.groupId);
        const num = String(p.groupId).replace(/^group_0*/, '');
        L.marker([g.centroid.lat, g.centroid.lng], {
          icon: L.divIcon({
            className: 'centroid-icon',
            html: '<div class="centroid-icon" style="width:24px;height:24px;background:' +
              color + '">' + esc(num) + '</div>',
            iconSize: [24, 24], iconAnchor: [12, 12]
          })
        }).addTo(layer).bindPopup('<b>' + esc(p.groupId) + '</b>');
      }
    }
  }

  if (!fitted && allLatLngs.length > 0) {
    map.fitBounds(allLatLngs, { padding: [40, 40] });
    fitted = true;
  }

  renderTable(filtered);
  renderSupport(state);
}

function renderTable(filtered) {
  const tbody = document.getElementById('points-tbody');
  const empty = document.getElementById('points-empty');
  tbody.innerHTML = '';
  empty.style.display = filtered.length ? 'none' : 'block';

  for (const p of filtered) {
    const tr = document.createElement('tr');
    const pillClass = p.status === 'grouped' ? 'status-grouped' : 'status-waiting';
    const pillText = p.status === 'grouped' ? 'В группе' : 'Ожидает';
    const when = new Date(p.createdAt).toLocaleString();
    tr.innerHTML =
      '<td>' + esc(p.displayName) + '</td>' +
      '<td>' + esc(p.phone) + '</td>' +
      '<td>' + esc(campusName(p.campusId)) + '</td>' +
      '<td>' + esc(p.language) + '</td>' +
      '<td><span class="status-pill ' + pillClass + '">' + pillText + '</span></td>' +
      '<td>' + esc(p.groupId || '—') + '</td>' +
      '<td>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) + '</td>' +
      '<td>' + esc(when) + '</td>' +
      '<td></td>';
    const actions = tr.lastElementChild;

    const locate = document.createElement('button');
    locate.className = 'row-btn';
    locate.textContent = '🎯';
    locate.title = 'Показать на карте';
    locate.addEventListener('click', () => {
      map.setView([p.lat, p.lng], 15);
      document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const exp = document.createElement('button');
    exp.className = 'row-btn';
    exp.textContent = '📄';
    exp.title = 'Экспорт в Word';
    exp.addEventListener('click', () => download('/export/point?id=' + encodeURIComponent(p.id)));

    actions.appendChild(locate);
    actions.appendChild(exp);
    tbody.appendChild(tr);
  }
}

function renderSupport(state) {
  const tickets = (state.supportTickets || []).slice().reverse();
  document.getElementById('support-count').textContent = String(tickets.length);
  const supportEl = document.getElementById('support');
  supportEl.innerHTML = '';
  if (tickets.length === 0) {
    supportEl.innerHTML = '<div class="empty">Нет обращений</div>';
  }
  for (const tk of tickets) {
    const when = new Date(tk.createdAt).toLocaleString();
    const card = document.createElement('div');
    card.className = 'ticket-card';
    card.innerHTML =
      '<div class="ticket-head">' + esc(tk.displayName) + ' · 📞 ' + esc(tk.phone) +
      ' · ' + esc(tk.language) + '</div>' +
      '<div class="ticket-time">' + esc(when) + '</div>' +
      '<div class="ticket-text">' + esc(tk.text) + '</div>';
    supportEl.appendChild(card);
  }
}

// ---- downloads (fetch -> blob, carries the token) ---------------------------
async function download(url) {
  try {
    let resp = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
    if (resp.status === 401 && promptToken()) {
      resp = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const disp = resp.headers.get('content-disposition') || '';
    const match = disp.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'export.docx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showError('Не удалось скачать документ: ' + e.message);
  }
}

// ---- polling ----------------------------------------------------------------
async function refresh() {
  let resp;
  try {
    resp = await fetch('/data/state.json', { headers: authHeaders(), cache: 'no-store' });
    if (resp.status === 401) {
      if (promptToken()) return refresh();
      showError('Требуется токен администратора.');
      return;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  } catch (e) {
    showError('Бот ещё не создал состояние (data/state.json): ' + e.message);
    return;
  }
  showError('');
  render(await resp.json());
}

// ---- wiring -----------------------------------------------------------------
function reRender() { if (lastState) render(lastState); }

document.getElementById('f-status').addEventListener('change', (e) => {
  filters.status = e.target.value; reRender();
});
document.getElementById('f-campus').addEventListener('change', (e) => {
  filters.campus = e.target.value; reRender();
});
document.getElementById('f-language').addEventListener('change', (e) => {
  filters.language = e.target.value; reRender();
});
document.getElementById('f-search').addEventListener('input', (e) => {
  filters.query = e.target.value; reRender();
});

document.getElementById('export-all-btn').addEventListener('click', () => {
  if (!lastState) return;
  const ids = applyFilters(lastState.participants).map((p) => p.id);
  if (ids.length === 0) { showError('Нет точек по фильтру для экспорта.'); return; }
  download('/export/points?ids=' + encodeURIComponent(ids.join(',')));
});

const rebuildBtn = document.getElementById('rebuild-btn');
rebuildBtn.addEventListener('click', async () => {
  if (!confirm('Пересобрать все группы заново?')) return;
  rebuildBtn.disabled = true;
  const original = rebuildBtn.textContent;
  rebuildBtn.textContent = 'Пересборка…';
  try {
    let resp = await fetch('/rebuild', { method: 'POST', headers: authHeaders() });
    if (resp.status === 401 && promptToken()) {
      resp = await fetch('/rebuild', { method: 'POST', headers: authHeaders() });
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await refresh();
  } catch (e) {
    showError('Не удалось пересобрать группы: ' + e.message);
  } finally {
    rebuildBtn.disabled = false;
    rebuildBtn.textContent = original;
  }
});

updateTokenStatus();
refresh();
setInterval(refresh, REFRESH_MS);
