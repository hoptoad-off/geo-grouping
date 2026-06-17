const REFRESH_MS = 5000;
const GROUP_PALETTE = [
  '#1e88e5', '#43a047', '#fb8c00', '#8e24aa',
  '#e53935', '#00897b', '#fdd835', '#6d4c41',
];
const WAITING_COLOR = '#757575';
const DEFAULT_CENTER = [41.3111, 69.2797];

/**
 * Escapes a value for safe interpolation into HTML. displayName comes from
 * Telegram and is untrusted, so every string entering innerHTML / a popup
 * must pass through this first.
 *
 * @param {unknown} value - Raw value to render.
 * @returns {string} HTML-safe string.
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const map = L.map('map', { preferCanvas: true }).setView(DEFAULT_CENTER, 11);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// if OSM tiles fail repeatedly, switch to Carto once (same fallback as app.js)
let tileErrors = 0, switched = false;
osm.on('tileerror', () => {
  if (switched || ++tileErrors < 4) return;
  switched = true;
  map.removeLayer(osm);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
});

const layer = L.featureGroup().addTo(map);
let fitted = false; // fitBounds only on first load with points

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function groupColor(index) {
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

function render(state) {
  layer.clearLayers();

  const byId = {};
  for (const p of state.participants) byId[p.id] = p;

  const groups = state.groups || [];
  const allLatLngs = [];

  groups.forEach((group, index) => {
    const color = groupColor(index);
    const members = group.memberIds.map((id) => byId[id]).filter(Boolean);

    for (const p of members) {
      allLatLngs.push([p.lat, p.lng]);
      L.circleMarker([p.lat, p.lng], {
        radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95
      }).addTo(layer).bindPopup(
        '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
        '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
        '<br>Группа: ' + esc(group.groupId)
      );
      L.polyline([[group.centroid.lat, group.centroid.lng], [p.lat, p.lng]], {
        color, weight: 1.5, opacity: 0.6, dashArray: '4 4'
      }).addTo(layer);
    }

    const num = String(group.groupId).replace(/^group_0*/, '');
    L.marker([group.centroid.lat, group.centroid.lng], {
      icon: L.divIcon({
        className: 'centroid-icon',
        html: '<div class="centroid-icon" style="width:24px;height:24px;background:' +
          color + '">' + esc(num) + '</div>',
        iconSize: [24, 24], iconAnchor: [12, 12]
      })
    }).addTo(layer).bindPopup(
      '<b>' + esc(group.groupId) + '</b><br>Участники: ' +
      members.map((p) => esc(p.displayName)).join(', ')
    );
  });

  const waiting = state.participants.filter((p) => p.status === 'waiting');
  for (const p of waiting) {
    allLatLngs.push([p.lat, p.lng]);
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#fff', weight: 1.5, fillColor: WAITING_COLOR, fillOpacity: 0.95
    }).addTo(layer).bindPopup(
      '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
      '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
      '<br><i>в очереди</i>'
    );
  }

  document.getElementById('meta').innerHTML =
    'Групп: ' + groups.length + ' · Ожидают: ' + waiting.length;

  const container = document.getElementById('groups');
  container.innerHTML = '';
  if (state.participants.length === 0) {
    container.innerHTML = '<div class="empty">Нет активных участников</div>';
  }
  groups.forEach((group, index) => {
    const color = groupColor(index);
    const members = group.memberIds.map((id) => byId[id]).filter(Boolean);
    const card = document.createElement('div');
    card.className = 'group-card';
    card.style.borderLeftColor = color;
    card.innerHTML =
      '<h2>' + esc(group.groupId) + '</h2>' +
      '<ul>' + members.map((p) => '<li>• ' + esc(p.displayName) + '</li>').join('') + '</ul>';
    card.addEventListener('click', () => {
      const ll = members.map((p) => [p.lat, p.lng]);
      if (ll.length) map.fitBounds(ll, { padding: [60, 60], maxZoom: 15 });
    });
    container.appendChild(card);
  });

  if (!fitted && allLatLngs.length > 0) {
    map.fitBounds(allLatLngs, { padding: [40, 40] });
    fitted = true;
  }
}

async function refresh() {
  let state;
  try {
    const resp = await fetch('/data/state.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    state = await resp.json();
  } catch (e) {
    showError('Бот ещё не создал состояние (data/state.json): ' + e.message);
    return;
  }
  showError('');
  render(state);
}

refresh();
setInterval(refresh, REFRESH_MS);

const rebuildBtn = document.getElementById('rebuild-btn');
rebuildBtn.addEventListener('click', async () => {
  if (!confirm('Пересобрать все группы заново?')) return;
  rebuildBtn.disabled = true;
  const original = rebuildBtn.textContent;
  rebuildBtn.textContent = 'Пересборка…';
  try {
    const resp = await fetch('/rebuild', { method: 'POST' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await refresh();
  } catch (e) {
    showError('Не удалось пересобрать группы: ' + e.message);
  } finally {
    rebuildBtn.disabled = false;
    rebuildBtn.textContent = original;
  }
});
