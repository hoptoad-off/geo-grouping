# Live Bot-State Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web map at `/live` that visualizes the Telegram bot's live state (`data/state.json`) — formed groups and waiting participants — auto-refreshing every 5 seconds, leaving the existing batch viewer at `/` untouched.

**Architecture:** Two new static assets (`viewer/live.html`, `viewer/live.js`) served by the existing `src/serve.ts`, which gets two minimal changes: a `/live` route and `data/state.json` added to its allow-list. `live.js` polls `/data/state.json` and redraws a Leaflet map; it is a plain browser script in the same style as the existing `viewer/app.js`.

**Tech Stack:** TypeScript (serve.ts), vanilla browser JS + vendored Leaflet, `node:http`.

---

## Testing convention for this feature

The viewer is browser code. The project's existing viewer (`viewer/app.js`) has no
unit tests, and the `node:test` runner targets Node modules, not the DOM. Following
that established convention, the new browser script is verified manually in the
browser, and the `serve.ts` allow-list change is verified with exact `curl` commands.
The bot's 19 unit tests must stay green and untouched.

**Important:** `npm run viz` runs `src/serve.ts` through `tsx` with no hot-reload. After
any edit to `serve.ts` you MUST restart the viewer for changes to take effect:
```bash
pkill -f "tsx src/serve.ts"; sleep 1; npm run viz &
```

---

## File Structure

- `src/serve.ts` (modify) — add `/live` → `viewer/live.html` route; add `data/state.json` to the static allow-list.
- `viewer/live.html` (new) — page shell (mirrors `viewer/index.html`), loads vendored Leaflet + `live.js`.
- `viewer/live.js` (new) — polls `/data/state.json` every 5 s and renders groups + waiting participants.
- Unchanged: `viewer/index.html`, `viewer/app.js`, all `src/*` bot modules.

---

## Task 1: Serve the live page and expose state.json

**Files:**
- Modify: `src/serve.ts:30` (route) and `src/serve.ts:36-39` (allow-list)

- [ ] **Step 1: Add the `/live` route**

In `src/serve.ts`, the current line 30 is:
```typescript
  let filePath = url.pathname === '/' ? '/viewer/index.html' : url.pathname;
```
Replace it with:
```typescript
  let filePath =
    url.pathname === '/'
      ? '/viewer/index.html'
      : url.pathname === '/live'
        ? '/viewer/live.html'
        : url.pathname;
```

- [ ] **Step 2: Add `data/state.json` to the allow-list**

In `src/serve.ts`, the current allow-list (lines 37-39) is:
```typescript
  const allowed =
    resolved.startsWith(path.join(ROOT, 'viewer') + path.sep) ||
    resolved === path.join(ROOT, 'data', 'output.json');
```
Replace it with:
```typescript
  const allowed =
    resolved.startsWith(path.join(ROOT, 'viewer') + path.sep) ||
    resolved === path.join(ROOT, 'data', 'output.json') ||
    resolved === path.join(ROOT, 'data', 'state.json');
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Restart the viewer and verify routes with curl**

Run:
```bash
pkill -f "tsx src/serve.ts"; sleep 1; (npm run viz &) ; sleep 3
echo -n "/live -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/live
echo -n "/data/state.json -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/data/state.json
echo -n "/data/input.json (must stay 403) -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/data/input.json
```
Expected output:
```
/live -> 404
/data/state.json -> 200
/data/input.json (must stay 403) -> 403
```
(`/live` is 404 until Task 2 creates `live.html`; `state.json` is 200 because the bot created it; `input.json` MUST remain 403 — the allow-list change must not widen access to other data files.)

- [ ] **Step 5: Commit**

```bash
git add src/serve.ts
git commit -m "feat: serve /live page and expose data/state.json"
```

---

## Task 2: Live page shell (HTML)

**Files:**
- Create: `viewer/live.html`

- [ ] **Step 1: Create `viewer/live.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Бот — живая карта</title>
  <link rel="icon" href="data:," />
  <link rel="stylesheet" href="/viewer/vendor/leaflet/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; height: 100vh; display: flex; }
    #sidebar {
      width: 320px; min-width: 320px; height: 100vh; overflow-y: auto;
      background: #1e1e2e; color: #e0e0e0; padding: 16px;
    }
    #sidebar h1 { font-size: 18px; margin-bottom: 4px; }
    #sidebar .meta { font-size: 12px; color: #9090a0; margin-bottom: 16px; }
    .legend { font-size: 13px; margin-bottom: 16px; line-height: 1.8; }
    .dot {
      display: inline-block; width: 12px; height: 12px; border-radius: 50%;
      margin-right: 6px; vertical-align: middle;
    }
    .group-card {
      background: #2a2a3c; border-radius: 8px; padding: 10px 12px;
      margin-bottom: 10px; cursor: pointer; border-left: 4px solid transparent;
      transition: background 0.15s;
    }
    .group-card:hover { background: #34344a; }
    .group-card h2 { font-size: 14px; margin-bottom: 4px; }
    .group-card ul { list-style: none; font-size: 12px; color: #c8c8d8; }
    .group-card li { padding: 1px 0; }
    .empty { font-size: 13px; color: #9090a0; }
    #map { flex: 1; height: 100vh; }
    .centroid-icon {
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 11px;
      border-radius: 50%; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }
    #error {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      background: #c62828; color: #fff; padding: 10px 18px; border-radius: 6px;
      display: none; z-index: 2000;
    }
  </style>
</head>
<body>
  <div id="sidebar">
    <h1>Бот — живая карта</h1>
    <div class="meta" id="meta">Загрузка…</div>
    <div class="legend">
      <div><span class="dot" style="background:#1e88e5"></span>В группе (цвет = группа)</div>
      <div><span class="dot" style="background:#757575"></span>Ожидают в очереди</div>
    </div>
    <div id="groups"></div>
  </div>
  <div id="map"></div>
  <div id="error"></div>

  <script src="/viewer/vendor/leaflet/leaflet.js"></script>
  <script src="/viewer/live.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it is served**

The viewer from Task 1 is already running. Run:
```bash
echo -n "/live -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/live
```
Expected:
```
/live -> 200
```
(No restart needed — `live.html` is a static file, served on demand.)

- [ ] **Step 3: Commit**

```bash
git add viewer/live.html
git commit -m "feat: add live bot map page shell"
```

---

## Task 3: Live map rendering + polling (JS)

**Files:**
- Create: `viewer/live.js`

- [ ] **Step 1: Create `viewer/live.js`**

```javascript
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
```

- [ ] **Step 2: Confirm the script is served and bot tests stay green**

Run:
```bash
echo -n "/viewer/live.js -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/viewer/live.js
npm test 2>&1 | tail -4
```
Expected: `/viewer/live.js -> 200`, and `pass 19 / fail 0`.

- [ ] **Step 3: Manual browser smoke test**

With the bot (`npm run bot`) and viewer (`npm run viz`) both running, open
`http://127.0.0.1:8080/live` and verify:
1. With no participants: sidebar shows "Групп: 0 · Ожидают: 0" and "Нет активных участников"; map at default Tashkent view.
2. Send one location in Telegram → within 5 s a grey marker appears, "Ожидают: 1".
3. Send two more within 5 km → markers recolor into a group with dashed spokes to a numbered centroid; "Групп: 1 · Ожидают: 0"; a group card lists the three names.
4. Pan/zoom the map, then wait through a refresh → the view is NOT reset (fitBounds only ran on first load).
5. `/leave` a grouped member in Telegram → within 5 s the group disperses back to grey waiting markers (or regroups if enough remain).
6. Confirm `http://127.0.0.1:8080/` (batch viewer) still renders unchanged.

- [ ] **Step 4: Commit**

```bash
git add viewer/live.js
git commit -m "feat: render live bot groups and waiting participants with 5s polling"
```

---

## Self-Review Notes

- **Spec coverage:** `/live` route + state.json exposure (Task 1); groups colored with centroid spokes + grey waiting markers + sidebar counts/cards (Task 3); names shown and escaped via `esc()` (Task 3); 5 s polling with single `featureGroup.clearLayers()` and first-load-only `fitBounds` (Task 3); missing-file and empty-state handling (Task 3 `refresh`/`render`); batch viewer untouched, security headers reused from existing `serve.ts` (Tasks 1-2); manual test convention (Task 3). All spec sections covered.
- **Placeholder scan:** every step has complete code and exact commands; no TBD/TODO.
- **Type/name consistency:** `state.participants` / `state.groups` / `group.memberIds` / `group.centroid` / `p.status` / `p.displayName` match the `state.json` shape in the spec and the bot's `BotState`/`Participant`/`Group` types. `esc`, `render`, `refresh`, `groupColor`, `layer`, `fitted`, `REFRESH_MS` are defined once and used consistently.
</content>
