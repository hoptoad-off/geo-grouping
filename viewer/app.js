const TIER_COLORS = { 1: '#2e7d32', 2: '#f9a825', 3: '#c62828' };
const UNASSIGNED_COLOR = '#757575';

/**
 * Escapes a value for safe interpolation into HTML. Data in output.json
 * (point names/ids) may be attacker-controlled, so every string that ends
 * up in innerHTML or a Leaflet popup must pass through this first.
 *
 * @param {unknown} value - Raw value to render.
 * @returns {string} HTML-safe string.
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// initial view must be set BEFORE any layers are added,
// otherwise Leaflet's renderer crashes; fitBounds refines it later
const map = L.map('map', { preferCanvas: true }).setView([41.3111, 69.2797], 11);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// if OSM tiles fail repeatedly, switch to Carto once
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

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function init() {
  let result;
  try {
    const resp = await fetch('/data/output.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    result = await resp.json();
  } catch (e) {
    showError('Не удалось загрузить data/output.json: ' + e.message +
      '. Сначала выполните npm start, затем запустите страницу через npm run viz.');
    map.setView([41.3111, 69.2797], 11);
    return;
  }

  const allLatLngs = [];
  const groupLayers = {};

  // Destination star
  const dest = result.destination;
  L.marker([dest.lat, dest.lng], {
    icon: L.divIcon({ className: 'dest-icon', html: '⭐', iconSize: [26, 26], iconAnchor: [13, 13] })
  }).addTo(map).bindPopup(
    '<b>Пункт назначения</b><br>' + dest.lat.toFixed(4) + ', ' + dest.lng.toFixed(4)
  );
  allLatLngs.push([dest.lat, dest.lng]);

  for (const group of result.groups) {
    const color = TIER_COLORS[group.tier];
    const layer = L.featureGroup().addTo(map);
    groupLayers[group.groupId] = layer;

    for (const p of group.points) {
      allLatLngs.push([p.lat, p.lng]);
      L.circleMarker([p.lat, p.lng], {
        radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95
      }).addTo(layer).bindPopup(
        '<b>' + esc(p.name) + '</b><br>id: ' + esc(p.id) +
        '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
        '<br>Группа: ' + esc(group.groupId) + ' (Tier ' + group.tier + ')'
      );
      // spoke from centroid to each member point
      L.polyline([[group.centroid.lat, group.centroid.lng], [p.lat, p.lng]], {
        color, weight: 1.5, opacity: 0.6, dashArray: '4 4'
      }).addTo(layer);
    }

    const num = String(group.groupId).replace(/^group_0*/, '');
    L.marker([group.centroid.lat, group.centroid.lng], {
      icon: L.divIcon({
        className: 'centroid-icon',
        html: '<div class="centroid-icon" style="width:24px;height:24px;background:' + color + '">' + esc(num) + '</div>',
        iconSize: [24, 24], iconAnchor: [12, 12]
      })
    }).addTo(layer).bindPopup(
      '<b>' + esc(group.groupId) + '</b> — Tier ' + group.tier +
      '<br>До назначения: ' + group.distanceToDestination.toFixed(2) + ' км' +
      '<br>Точки: ' + group.points.map(p => esc(p.name)).join(', ')
    );
  }

  for (const p of result.unassigned) {
    allLatLngs.push([p.lat, p.lng]);
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#fff', weight: 1.5, fillColor: UNASSIGNED_COLOR, fillOpacity: 0.95
    }).addTo(map).bindPopup('<b>' + esc(p.name) + '</b><br>id: ' + esc(p.id) + '<br><i>Нераспределена</i>');
  }

  map.fitBounds(allLatLngs, { padding: [40, 40] });

  // Sidebar
  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  result.groups.forEach(g => tierCounts[g.tier]++);
  document.getElementById('meta').innerHTML =
    'Групп: ' + result.totalGroups +
    ' (T1: ' + tierCounts[1] + ', T2: ' + tierCounts[2] + ', T3: ' + tierCounts[3] + ')' +
    ' · Нераспределено: ' + result.unassigned.length +
    '<br>Сгенерировано: ' + esc(new Date(result.generatedAt).toLocaleString('ru-RU'));

  const container = document.getElementById('groups');
  for (const group of result.groups) {
    const color = TIER_COLORS[group.tier];
    const card = document.createElement('div');
    card.className = 'group-card';
    card.style.borderLeftColor = color;
    card.innerHTML =
      '<h2>' + esc(group.groupId) +
      '<span class="tier-badge" style="background:' + color + '">Tier ' + group.tier + '</span></h2>' +
      '<div class="dist">' + group.distanceToDestination.toFixed(2) + ' км до назначения</div>' +
      '<ul>' + group.points.map(p => '<li>• ' + esc(p.name) + '</li>').join('') + '</ul>';
    card.addEventListener('click', () => {
      map.fitBounds(groupLayers[group.groupId].getBounds(), { padding: [60, 60], maxZoom: 15 });
    });
    container.appendChild(card);
  }
}

init();
