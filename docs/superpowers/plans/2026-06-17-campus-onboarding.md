# Campus Onboarding, Phone, i18n & Campus Markers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перед приёмом геолокации бот собирает язык, кампус и телефон; группировка идёт только внутри кампуса; на живой карте появляются маркеры кампусов, телефон и кампус участника; бот локализован на en/ru/uz.

**Architecture:** Кампусы — общий константный модуль (`src/campuses.ts`), пишутся в `state.json` для карты. Онбординг — чистый конечный автомат (`src/onboarding.ts`), который `bot.ts` подключает к Telegram I/O. Профиль (язык/кампус/телефон) хранится в `BotState.profiles` по `telegramUserId`. Чистый matcher не трогаем — разбиение по кампусам делает `store` перед вызовом `findGroups`/`optimizeGroups`. i18n — словарь `strings[lang][key]` + `t()`.

**Tech Stack:** TypeScript (ESM, `.js`-импорты), grammY, Node `node:test` + `tsx`, Leaflet (статика).

## Global Constraints

- Импорты внутри `src/` — с расширением `.js` (ESM, `"type": "module"`).
- Тесты: `node:test` + `node:assert/strict`, файлы `src/*.test.ts`, запуск `npm test`.
- Кампусы (канонические координаты, не менять): Mirzo Ulugbek `41.356250, 69.373209`; Yashnobod `41.256928, 69.328708`.
- Языки: ровно `'en' | 'ru' | 'uz'`. Узбекский — латиница.
- Телефон собирается только через Telegram `requestContact`; принимать контакт только если `contact.user_id === from.id`.
- Группа никогда не смешивает кампусы.
- Карта остаётся на `127.0.0.1`; все недоверенные строки (включая `phone`) проходят через `esc()`.
- Линию «группа → кампус» на карте НЕ рисуем (вне scope).

---

### Task 1: Константы кампусов (`src/campuses.ts`)

**Files:**
- Create: `src/campuses.ts`
- Test: `src/campuses.test.ts`

**Interfaces:**
- Produces: `interface Campus { id: string; nameKey: string; lat: number; lng: number }`; `const CAMPUSES: Campus[]`; `function campusById(id: string): Campus | undefined`.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/campuses.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPUSES, campusById } from './campuses.js';

test('CAMPUSES has the two branches with exact coordinates', () => {
  assert.equal(CAMPUSES.length, 2);
  const mu = campusById('mirzo_ulugbek');
  assert.ok(mu);
  assert.equal(mu!.lat, 41.356250);
  assert.equal(mu!.lng, 69.373209);
  const ya = campusById('yashnobod');
  assert.ok(ya);
  assert.equal(ya!.lat, 41.256928);
  assert.equal(ya!.lng, 69.328708);
});

test('campusById returns undefined for unknown id', () => {
  assert.equal(campusById('nope'), undefined);
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm test -- --test-name-pattern='CAMPUSES|campusById'`
Expected: FAIL (`Cannot find module './campuses.js'`).

- [ ] **Step 3: Реализовать модуль**

```ts
// src/campuses.ts

/** A destination branch users can head to. Coordinates are physical and fixed. */
export interface Campus {
  id: string;      // 'mirzo_ulugbek' | 'yashnobod'
  nameKey: string; // i18n key for the display label
  lat: number;
  lng: number;
}

export const CAMPUSES: Campus[] = [
  { id: 'mirzo_ulugbek', nameKey: 'campus.mirzoUlugbek', lat: 41.356250, lng: 69.373209 },
  { id: 'yashnobod', nameKey: 'campus.yashnobod', lat: 41.256928, lng: 69.328708 },
];

/** Looks up a campus by id. */
export function campusById(id: string): Campus | undefined {
  return CAMPUSES.find((c) => c.id === id);
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npm test -- --test-name-pattern='CAMPUSES|campusById'`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/campuses.ts src/campuses.test.ts
git commit -m "feat: add campus constants module"
```

---

### Task 2: i18n-словарь (`src/i18n.ts`)

**Files:**
- Create: `src/i18n.ts`
- Test: `src/i18n.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `type Language = 'en' | 'ru' | 'uz'` (канонический источник типа); `const LANGUAGES: Language[]`; `function t(lang: Language, key: string, params?: Record<string, string | number>): string`.

> Примечание: `Language` объявляется здесь и реэкспортируется из `types.ts` в Task 3, чтобы не было дубля определения.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/i18n.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, LANGUAGES, strings } from './i18n.js';

test('every language has every key', () => {
  const keys = Object.keys(strings.en);
  for (const lang of LANGUAGES) {
    for (const k of keys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(strings[lang], k),
        `missing key "${k}" for language "${lang}"`
      );
    }
  }
});

test('t interpolates params', () => {
  assert.match(t('ru', 'status.grouped', { group: 'group_001' }), /group_001/);
});

test('t falls back to the key when missing', () => {
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm test -- --test-name-pattern='language has every key|interpolates|falls back'`
Expected: FAIL (`Cannot find module './i18n.js'`).

- [ ] **Step 3: Реализовать модуль**

```ts
// src/i18n.ts

/** Supported UI languages (Uzbek is Latin script). */
export type Language = 'en' | 'ru' | 'uz';
export const LANGUAGES: Language[] = ['en', 'ru', 'uz'];

type Dict = Record<string, string>;

export const strings: Record<Language, Dict> = {
  en: {
    'onboarding.chooseLanguage': 'Choose language / Выберите язык / Tilni tanlang',
    'onboarding.chooseCampus': 'Choose your campus:',
    'onboarding.sharePhone': 'Please share your phone number using the button below:',
    'onboarding.contactMismatch': 'Please share your own contact.',
    'onboarding.sendLocation': 'Now send your location using the button below:',
    'btn.sharePhone': '📱 Share contact',
    'btn.sendLocation': '📍 Send location',
    'campus.mirzoUlugbek': 'Mirzo Ulugbek',
    'campus.yashnobod': 'Yashnobod',
    'location.accepted': '📍 Location received! Looking for a group for you…',
    'location.invalid': 'Could not read the coordinates, please try again.',
    'location.noProfile': 'Send /start first to choose language and campus.',
    'group.formedTitle': '✅ Group formed!',
    'group.neighbors': 'Your neighbors:',
    'group.dissolved': '⚠️ Your group broke up. Looking for a new one…',
    'unit.km': 'km',
    'leave.confirm': 'You have left.',
    'leave.groupDissolved': ' Your group was dissolved.',
    'common.noActive': 'You have no active locations.',
    'status.header': 'Your status:',
    'status.grouped': 'in group {group}',
    'status.waiting': 'waiting',
    'reset.done': 'All your locations were removed.',
  },
  ru: {
    'onboarding.chooseLanguage': 'Выберите язык / Choose language / Tilni tanlang',
    'onboarding.chooseCampus': 'Выберите кампус:',
    'onboarding.sharePhone': 'Поделитесь номером телефона кнопкой ниже:',
    'onboarding.contactMismatch': 'Пожалуйста, поделитесь своим собственным контактом.',
    'onboarding.sendLocation': 'Теперь отправьте геолокацию кнопкой ниже:',
    'btn.sharePhone': '📱 Поделиться контактом',
    'btn.sendLocation': '📍 Отправить геолокацию',
    'campus.mirzoUlugbek': 'Мирзо Улугбек',
    'campus.yashnobod': 'Яшнобод',
    'location.accepted': '📍 Локация принята! Ищем для вас группу…',
    'location.invalid': 'Не удалось распознать координаты, попробуйте ещё раз.',
    'location.noProfile': 'Сначала отправьте /start, чтобы выбрать язык и кампус.',
    'group.formedTitle': '✅ Группа собрана!',
    'group.neighbors': 'Ваши соседи:',
    'group.dissolved': '⚠️ Группа распалась. Ищем для вас новую…',
    'unit.km': 'км',
    'leave.confirm': 'Вы вышли.',
    'leave.groupDissolved': ' Ваша группа распущена.',
    'common.noActive': 'У вас нет активных локаций.',
    'status.header': 'Ваш статус:',
    'status.grouped': 'в группе {group}',
    'status.waiting': 'в очереди',
    'reset.done': 'Все ваши локации удалены.',
  },
  uz: {
    'onboarding.chooseLanguage': 'Tilni tanlang / Choose language / Выберите язык',
    'onboarding.chooseCampus': 'Kampusni tanlang:',
    'onboarding.sharePhone': 'Quyidagi tugma orqali telefon raqamingizni yuboring:',
    'onboarding.contactMismatch': 'Iltimos, oʻzingizning kontaktingizni yuboring.',
    'onboarding.sendLocation': 'Endi quyidagi tugma orqali joylashuvingizni yuboring:',
    'btn.sharePhone': '📱 Kontaktni yuborish',
    'btn.sendLocation': '📍 Joylashuvni yuborish',
    'campus.mirzoUlugbek': 'Mirzo Ulugbek',
    'campus.yashnobod': 'Yashnobod',
    'location.accepted': '📍 Joylashuv qabul qilindi! Sizga guruh qidiryapmiz…',
    'location.invalid': 'Koordinatalarni aniqlab boʻlmadi, qayta urinib koʻring.',
    'location.noProfile': 'Til va kampusni tanlash uchun avval /start yuboring.',
    'group.formedTitle': '✅ Guruh tuzildi!',
    'group.neighbors': 'Sizning qoʻshnilaringiz:',
    'group.dissolved': '⚠️ Guruhingiz tarqaldi. Sizga yangisini qidiryapmiz…',
    'unit.km': 'km',
    'leave.confirm': 'Siz chiqdingiz.',
    'leave.groupDissolved': ' Guruhingiz tarqatildi.',
    'common.noActive': 'Sizda faol joylashuvlar yoʻq.',
    'status.header': 'Sizning holatingiz:',
    'status.grouped': '{group} guruhida',
    'status.waiting': 'navbatda',
    'reset.done': 'Barcha joylashuvlaringiz oʻchirildi.',
  },
};

/**
 * Resolves a localized string, interpolating `{name}` placeholders. Falls back to the
 * key itself if missing (so a missing translation is visible, not a crash).
 */
export function t(
  lang: Language,
  key: string,
  params?: Record<string, string | number>
): string {
  const template = strings[lang]?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`
  );
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npm test -- --test-name-pattern='language has every key|interpolates|falls back'`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/i18n.ts src/i18n.test.ts
git commit -m "feat: add i18n dictionary for en/ru/uz"
```

---

### Task 3: Типы и store — профили + группировка по кампусу

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts` (обновить ожидание пустого состояния + добавить тесты)

**Interfaces:**
- Consumes: `Campus`, `CAMPUSES` (Task 1); `Language` (Task 2).
- Produces:
  - `Participant` с полями `campusId: string; phone: string; language: Language`.
  - `interface UserProfile { language: Language; campusId: string; phone: string }`.
  - `BotState` с `profiles: Record<string, UserProfile>` и `campuses: Campus[]`.
  - `NewParticipant` с `campusId: string; phone: string; language: Language`.
  - `Store.getProfile(telegramUserId: number): UserProfile | undefined`.
  - `Store.setProfile(telegramUserId: number, profile: UserProfile): void`.

- [ ] **Step 1: Обновить типы (`src/types.ts`)**

Добавить импорт и реэкспорт `Language`, расширить `Participant`, добавить `UserProfile`, расширить `BotState`:

```ts
// в начало файла:
import type { Campus } from './campuses.js';
import type { Language } from './i18n.js';
export type { Language };
```

В `interface Participant` добавить три поля после `lng`:

```ts
  campusId: string;   // which branch this submission targets
  phone: string;      // phone shared via Telegram contact
  language: Language; // recipient's language for notifications
```

Добавить новый интерфейс и расширить `BotState`:

```ts
/** Persisted onboarding result for one Telegram account. */
export interface UserProfile {
  language: Language;
  campusId: string;
  phone: string;
}
```

```ts
export interface BotState {
  seq: number;
  participants: Participant[];
  groups: Group[];
  profiles: Record<string, UserProfile>; // keyed by telegramUserId (as string)
  campuses: Campus[];                     // written on save for the live map
}
```

- [ ] **Step 2: Обновить существующий тест пустого состояния (`src/store.test.ts`)**

Заменить тест `load returns empty state for a missing file` и хелпер `np`:

```ts
// добавить импорты:
import { CAMPUSES } from './campuses.js';

// заменить хелпер np на версию с кампусом/телефоном/языком:
function np(lat: number, lng: number, uid = 1, campusId = 'mirzo_ulugbek'): NewParticipant {
  return {
    telegramUserId: uid, chatId: uid, displayName: `u${uid}`,
    lat, lng, campusId, phone: '+998900000000', language: 'ru',
  };
}

// заменить тело теста пустого состояния:
test('load returns empty state for a missing file', async () => {
  const store = await Store.load(tmpPath());
  assert.deepEqual(store.getState(), {
    seq: 0, participants: [], groups: [], profiles: {}, campuses: CAMPUSES,
  });
});
```

- [ ] **Step 3: Написать падающие тесты группировки по кампусу и профиля**

Добавить в `src/store.test.ts`:

```ts
test('joinAndMatch never mixes campuses', async () => {
  const store = await Store.load(tmpPath());
  // три точки рядом, но разные кампусы → группа не собирается
  store.joinAndMatch(np(41.30, 69.28, 1, 'mirzo_ulugbek'), 5, 3);
  store.joinAndMatch(np(41.31, 69.28, 2, 'yashnobod'), 5, 3);
  const third = store.joinAndMatch(np(41.30, 69.29, 3, 'mirzo_ulugbek'), 5, 3);
  assert.equal(third.formedGroups.length, 0);

  // добавляем ещё двух того же кампуса → собирается ровно их кампус
  store.joinAndMatch(np(41.305, 69.285, 4, 'mirzo_ulugbek'), 5, 3);
  const fifth = store.joinAndMatch(np(41.302, 69.286, 5, 'mirzo_ulugbek'), 5, 3);
  assert.equal(fifth.formedGroups.length, 1);
  for (const m of fifth.formedGroups[0].members) {
    assert.equal(m.campusId, 'mirzo_ulugbek');
  }
});

test('rebuild keeps campuses separate', async () => {
  const store = await Store.load(tmpPath());
  for (let i = 0; i < 3; i++) store.joinAndMatch(np(41.30 + i * 0.001, 69.28, 10 + i, 'mirzo_ulugbek'), 5, 3);
  for (let i = 0; i < 3; i++) store.joinAndMatch(np(41.25 + i * 0.001, 69.32, 20 + i, 'yashnobod'), 5, 3);
  store.rebuild(5, 3);
  for (const g of store.getState().groups) {
    const campuses = new Set(
      g.memberIds.map((id) => store.getState().participants.find((p) => p.id === id)!.campusId)
    );
    assert.equal(campuses.size, 1);
  }
});

test('getProfile/setProfile round-trip and persist', async () => {
  const file = tmpPath();
  const store = await Store.load(file);
  assert.equal(store.getProfile(7), undefined);
  store.setProfile(7, { language: 'uz', campusId: 'yashnobod', phone: '+998901112233' });
  await store.save();
  const reloaded = await Store.load(file);
  assert.deepEqual(reloaded.getProfile(7), {
    language: 'uz', campusId: 'yashnobod', phone: '+998901112233',
  });
});
```

- [ ] **Step 4: Запустить — должны упасть**

Run: `npm test -- --test-name-pattern='never mixes campuses|keeps campuses separate|round-trip and persist|empty state for a missing'`
Expected: FAIL (тип/метод не существует, пустое состояние без `profiles`/`campuses`).

- [ ] **Step 5: Реализовать изменения store (`src/store.ts`)**

Добавить импорты:

```ts
import type { BotState, Participant, Group, UserProfile } from './types.js';
import { findGroups, optimizeGroups, type FormedGroup } from './matcher.js';
import { CAMPUSES } from './campuses.js';
```

Расширить `NewParticipant`:

```ts
export interface NewParticipant {
  telegramUserId: number;
  chatId: number;
  displayName: string;
  lat: number;
  lng: number;
  campusId: string;
  phone: string;
  language: import('./types.js').Language;
}
```

В `load()` нормализовать состояние (миграция старых файлов + пустое состояние):

```ts
static async load(filePath: string = DEFAULT_PATH): Promise<Store> {
  let state: BotState;
  try {
    const raw = await readFile(filePath, 'utf-8');
    state = JSON.parse(raw) as BotState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      state = { seq: 0, participants: [], groups: [], profiles: {}, campuses: CAMPUSES };
    } else {
      throw err;
    }
  }
  // normalize: ensure new fields exist and campuses are canonical
  state.profiles ??= {};
  state.campuses = CAMPUSES;
  return new Store(state, filePath);
}
```

Добавить методы профиля (после `participantsByUser`):

```ts
/** Returns the stored onboarding profile for a Telegram account, if any. */
getProfile(telegramUserId: number): UserProfile | undefined {
  return this.state.profiles[String(telegramUserId)];
}

/** Stores/overwrites the onboarding profile for a Telegram account. */
setProfile(telegramUserId: number, profile: UserProfile): void {
  this.state.profiles[String(telegramUserId)] = profile;
}
```

Переписать `runMatch` с разбиением по кампусу:

```ts
private runMatch(radiusKm: number, groupSize: number): GroupWithMembers[] {
  const byCampus = new Map<string, Participant[]>();
  for (const p of this.waiting()) {
    const arr = byCampus.get(p.campusId) ?? [];
    arr.push(p);
    byCampus.set(p.campusId, arr);
  }

  const result: GroupWithMembers[] = [];
  for (const pool of byCampus.values()) {
    const formed = findGroups(pool, radiusKm, groupSize);
    for (const fg of formed) {
      const groupId = this.nextId('group');
      const members = fg.memberIds
        .map((id) => this.byId(id))
        .filter((p): p is Participant => p !== null);
      const group: Group = {
        groupId,
        memberIds: fg.memberIds,
        centroid: fg.centroid,
        createdAt: new Date().toISOString(),
      };
      this.state.groups.push(group);
      for (const m of members) {
        m.status = 'grouped';
        m.groupId = groupId;
      }
      result.push({ group, members });
    }
  }
  return result;
}
```

В `joinAndMatch` прокинуть новые поля в участника:

```ts
const participant: Participant = {
  id: this.nextId('u'),
  telegramUserId: input.telegramUserId,
  chatId: input.chatId,
  displayName: input.displayName,
  lat: input.lat,
  lng: input.lng,
  campusId: input.campusId,
  phone: input.phone,
  language: input.language,
  status: 'waiting',
  groupId: null,
  createdAt: new Date().toISOString(),
};
```

Переписать `rebuild` с разбиением по кампусу (оптимизируем каждый кампус отдельно, затем собираем единый layout и применяем как раньше):

```ts
rebuild(radiusKm: number, groupSize: number): { changed: number } {
  const participants = this.state.participants;
  const campusOf = (id: string): string | undefined =>
    participants.find((p) => p.id === id)?.campusId;

  const campusIds = [...new Set(participants.map((p) => p.campusId))];
  const layoutGroups: FormedGroup[] = [];
  for (const cid of campusIds) {
    const parts = participants.filter((p) => p.campusId === cid);
    const grps = this.state.groups.filter((g) => campusOf(g.memberIds[0]) === cid);
    const layout = optimizeGroups(parts, grps, radiusKm, groupSize);
    layoutGroups.push(...layout.groups);
  }

  const key = (ids: string[]): string => [...ids].sort().join(',');
  const oldSets = new Set(this.state.groups.map((g) => key(g.memberIds)));

  const newGroups: Group[] = layoutGroups.map((fg) => ({
    groupId: this.nextId('group'),
    memberIds: fg.memberIds,
    centroid: fg.centroid,
    createdAt: new Date().toISOString(),
  }));

  const groupIdByMember = new Map<string, string>();
  for (const g of newGroups) for (const id of g.memberIds) groupIdByMember.set(id, g.groupId);

  for (const p of participants) {
    const gid = groupIdByMember.get(p.id);
    if (gid) {
      p.status = 'grouped';
      p.groupId = gid;
    } else {
      p.status = 'waiting';
      p.groupId = null;
    }
  }
  this.state.groups = newGroups;

  const changed = newGroups.filter((g) => !oldSets.has(key(g.memberIds))).length;
  return { changed };
}
```

> Примечание: `optimizeGroups` бросает ошибку, если у `grouped`-участника нет исходной группы; так как мы фильтруем `grps` и `parts` по одному `cid`, исходные группы каждого кампуса передаются целиком — инвариант сохраняется.

Экспорт `FormedGroup` из matcher уже есть (`export interface FormedGroup`); добавить его в импорт (см. выше).

- [ ] **Step 6: Запустить целевые тесты — должны пройти**

Run: `npm test -- --test-name-pattern='never mixes campuses|keeps campuses separate|round-trip and persist|empty state for a missing'`
Expected: PASS.

- [ ] **Step 7: Запустить весь store-набор — без регрессий**

Run: `npm test -- src/store.test.ts`
Expected: PASS (все тесты store; обновлённый `np` прокидывает кампус во всё).

- [ ] **Step 8: Коммит**

```bash
git add src/types.ts src/store.ts src/store.test.ts
git commit -m "feat: per-campus grouping and user profiles in store"
```

---

### Task 4: Локализованные уведомления (`src/notify.ts`)

**Files:**
- Modify: `src/notify.ts`
- Modify: `src/notify.test.ts`

**Interfaces:**
- Consumes: `t`, `Language` (Task 2); `Participant` (имеет `.language`).
- Produces: `formatGroupFormed(members: Participant[], self: Participant): string` — теперь использует `self.language`. `safeSend` без изменений сигнатуры.

- [ ] **Step 1: Обновить тест (`src/notify.test.ts`)**

Хелпер `p` должен задавать новые поля; добавить проверку локализации:

```ts
import type { Participant, Language } from './types.js';

function p(id: string, lat: number, lng: number, name: string, language: Language = 'ru'): Participant {
  return {
    id, telegramUserId: 1, chatId: 1, displayName: name, lat, lng,
    campusId: 'mirzo_ulugbek', phone: '+998900000000', language,
    status: 'grouped', groupId: 'group_001', createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('formatGroupFormed lists the other members with distances', () => {
  const self = p('a', 41.30, 69.28, 'Alice');
  const other = p('b', 41.31, 69.28, 'Bob');
  const text = formatGroupFormed([self, other], self);
  assert.match(text, /Bob/);
  assert.match(text, /км/); // ru recipient → км
  assert.ok(!text.includes('Alice'));
});

test('formatGroupFormed uses the recipient language', () => {
  const self = p('a', 41.30, 69.28, 'Alice', 'en');
  const other = p('b', 41.31, 69.28, 'Bob', 'en');
  const text = formatGroupFormed([self, other], self);
  assert.match(text, /Group formed/);
  assert.match(text, /km/);
});
```

- [ ] **Step 2: Запустить — новый тест падает**

Run: `npm test -- --test-name-pattern='recipient language'`
Expected: FAIL (текст всё ещё русский хардкод).

- [ ] **Step 3: Реализовать локализацию (`src/notify.ts`)**

```ts
import type { Api, RawApi } from 'grammy';
import type { Participant } from './types.js';
import { haversineKm } from './grouping.js';
import { t } from './i18n.js';

type BotApi = Api<RawApi>;

export async function safeSend(api: BotApi, chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (err) {
    console.error(`Failed to send message to ${chatId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Builds the "group formed" message from one member's perspective, in that member's
 * language, listing the other members and their distance from `self`.
 */
export function formatGroupFormed(members: Participant[], self: Participant): string {
  const lang = self.language;
  const km = t(lang, 'unit.km');
  const lines = members
    .filter((m) => m.id !== self.id)
    .map((o) => `• ${o.displayName} — ${haversineKm(self.lat, self.lng, o.lat, o.lng).toFixed(1)} ${km}`);
  return `${t(lang, 'group.formedTitle')}\n${t(lang, 'group.neighbors')}\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Запустить notify-тесты — должны пройти**

Run: `npm test -- src/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/notify.ts src/notify.test.ts
git commit -m "feat: localize group-formed notifications per recipient"
```

---

### Task 5: Чистый автомат онбординга (`src/onboarding.ts`)

**Files:**
- Create: `src/onboarding.ts`
- Test: `src/onboarding.test.ts`

**Interfaces:**
- Consumes: `Language` (Task 2); `UserProfile` (Task 3).
- Produces:
  - `type Step = 'language' | 'campus' | 'phone' | 'ready'`.
  - `interface OnboardingState { step: Step; language?: Language; campusId?: string; phone?: string }`.
  - `type OnboardingEvent = { type: 'language'; value: Language } | { type: 'campus'; value: string } | { type: 'phone'; value: string }`.
  - `interface AdvanceResult { state: OnboardingState; profile?: UserProfile }`.
  - `function startOnboarding(): OnboardingState`.
  - `function advance(state: OnboardingState, event: OnboardingEvent): AdvanceResult`.

- [ ] **Step 1: Написать падающий тест**

```ts
// src/onboarding.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOnboarding, advance } from './onboarding.js';

test('full happy path produces a profile at ready', () => {
  let s = startOnboarding();
  assert.equal(s.step, 'language');

  let r = advance(s, { type: 'language', value: 'uz' });
  assert.equal(r.state.step, 'campus');
  assert.equal(r.profile, undefined);

  r = advance(r.state, { type: 'campus', value: 'yashnobod' });
  assert.equal(r.state.step, 'phone');

  r = advance(r.state, { type: 'phone', value: '+998901112233' });
  assert.equal(r.state.step, 'ready');
  assert.deepEqual(r.profile, { language: 'uz', campusId: 'yashnobod', phone: '+998901112233' });
});

test('out-of-order events are ignored (stay on the same step)', () => {
  const s = startOnboarding();
  const r = advance(s, { type: 'phone', value: '+998900000000' });
  assert.equal(r.state.step, 'language');
  assert.equal(r.profile, undefined);
});

test('ready state is terminal', () => {
  let s = startOnboarding();
  s = advance(s, { type: 'language', value: 'en' }).state;
  s = advance(s, { type: 'campus', value: 'mirzo_ulugbek' }).state;
  s = advance(s, { type: 'phone', value: '+1' }).state;
  const r = advance(s, { type: 'language', value: 'ru' });
  assert.equal(r.state.step, 'ready');
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npm test -- src/onboarding.test.ts`
Expected: FAIL (`Cannot find module './onboarding.js'`).

- [ ] **Step 3: Реализовать автомат**

```ts
// src/onboarding.ts
import type { Language } from './i18n.js';
import type { UserProfile } from './types.js';

export type Step = 'language' | 'campus' | 'phone' | 'ready';

export interface OnboardingState {
  step: Step;
  language?: Language;
  campusId?: string;
  phone?: string;
}

export type OnboardingEvent =
  | { type: 'language'; value: Language }
  | { type: 'campus'; value: string }
  | { type: 'phone'; value: string };

export interface AdvanceResult {
  state: OnboardingState;
  profile?: UserProfile; // set only on transition into 'ready'
}

/** Begins a fresh onboarding at the language step. */
export function startOnboarding(): OnboardingState {
  return { step: 'language' };
}

/**
 * Pure transition: applies an event to the current step. Events that don't match the
 * expected step are ignored (state unchanged). Reaching 'ready' yields the profile.
 */
export function advance(state: OnboardingState, event: OnboardingEvent): AdvanceResult {
  switch (state.step) {
    case 'language':
      if (event.type !== 'language') return { state };
      return { state: { ...state, step: 'campus', language: event.value } };
    case 'campus':
      if (event.type !== 'campus') return { state };
      return { state: { ...state, step: 'phone', campusId: event.value } };
    case 'phone': {
      if (event.type !== 'phone') return { state };
      const next: OnboardingState = { ...state, step: 'ready', phone: event.value };
      return {
        state: next,
        profile: { language: next.language!, campusId: next.campusId!, phone: next.phone! },
      };
    }
    case 'ready':
      return { state };
  }
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npm test -- src/onboarding.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/onboarding.ts src/onboarding.test.ts
git commit -m "feat: pure onboarding state machine"
```

---

### Task 6: Подключение онбординга к боту (`src/bot.ts`)

**Files:**
- Modify: `src/bot.ts`

**Interfaces:**
- Consumes: `CAMPUSES` (Task 1); `t`, `LANGUAGES`, `Language` (Task 2); `Store.getProfile/setProfile`, `NewParticipant` (Task 3); `formatGroupFormed`, `safeSend` (Task 4); `startOnboarding`, `advance`, `OnboardingState` (Task 5).
- Produces: рабочий бот-процесс (проверяется сборкой/запуском, юнит-тестов нет).

- [ ] **Step 1: Переписать `src/bot.ts`**

Полное содержимое файла:

```ts
import { Bot, Keyboard } from 'grammy';
import type { Api, RawApi } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers } from './store.js';
import type { Language } from './types.js';
import { t, LANGUAGES } from './i18n.js';
import { CAMPUSES } from './campuses.js';
import { startOnboarding, advance, type OnboardingState } from './onboarding.js';
import { formatGroupFormed, safeSend } from './notify.js';
import { createViewerServer } from './viewer-server.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

/** In-flight onboarding wizards, keyed by Telegram user id (transient). */
const onboarding = new Map<number, OnboardingState>();

/** Fixed language button labels (language-independent). */
const LANG_BY_LABEL: Record<string, Language> = {
  English: 'en',
  'Русский': 'ru',
  "O'zbek": 'uz',
};
const LANG_LABELS = Object.keys(LANG_BY_LABEL);

function languageKeyboard(): Keyboard {
  return new Keyboard().text(LANG_LABELS[0]).text(LANG_LABELS[1]).text(LANG_LABELS[2]).resized().oneTime();
}

function campusKeyboard(lang: Language): Keyboard {
  const kb = new Keyboard();
  for (const c of CAMPUSES) kb.text(t(lang, c.nameKey));
  return kb.resized().oneTime();
}

function phoneKeyboard(lang: Language): Keyboard {
  return new Keyboard().requestContact(t(lang, 'btn.sharePhone')).resized().oneTime();
}

function locationKeyboard(lang: Language): Keyboard {
  return new Keyboard().requestLocation(t(lang, 'btn.sendLocation')).resized();
}

/** Resolves a campus id from a localized label for the given language. */
function campusByLabel(lang: Language, label: string): string | undefined {
  return CAMPUSES.find((c) => t(lang, c.nameKey) === label)?.id;
}

/** Notifies every member of each freshly formed group, in their own language. */
async function notifyFormed(api: Api<RawApi>, formed: GroupWithMembers[]): Promise<void> {
  for (const { members } of formed) {
    for (const member of members) {
      await safeSend(api, member.chatId, formatGroupFormed(members, member));
    }
  }
}

bot.command('start', async (ctx) => {
  onboarding.set(ctx.from!.id, startOnboarding());
  await ctx.reply(t('en', 'onboarding.chooseLanguage'), { reply_markup: languageKeyboard() });
});

// Language + campus arrive as plain text matching known button labels.
bot.on('message:text', async (ctx, next) => {
  const uid = ctx.from.id;
  const state = onboarding.get(uid);
  if (!state) return next(); // not onboarding → fall through to commands

  if (state.step === 'language') {
    const lang = LANG_BY_LABEL[ctx.message.text];
    if (!lang) return; // ignore non-button text on this step
    const { state: nextState } = advance(state, { type: 'language', value: lang });
    onboarding.set(uid, nextState);
    await ctx.reply(t(lang, 'onboarding.chooseCampus'), { reply_markup: campusKeyboard(lang) });
    return;
  }

  if (state.step === 'campus') {
    const lang = state.language!;
    const campusId = campusByLabel(lang, ctx.message.text);
    if (!campusId) return;
    const { state: nextState } = advance(state, { type: 'campus', value: campusId });
    onboarding.set(uid, nextState);
    await ctx.reply(t(lang, 'onboarding.sharePhone'), { reply_markup: phoneKeyboard(lang) });
    return;
  }
  // other steps ignore free text
});

// Phone arrives as a shared contact.
bot.on('message:contact', async (ctx) => {
  const uid = ctx.from.id;
  const state = onboarding.get(uid);
  if (!state || state.step !== 'phone') return;
  const lang = state.language!;

  const contact = ctx.message.contact;
  if (contact.user_id !== uid) {
    await ctx.reply(t(lang, 'onboarding.contactMismatch'), { reply_markup: phoneKeyboard(lang) });
    return;
  }

  const { state: nextState, profile } = advance(state, { type: 'phone', value: contact.phone_number });
  onboarding.set(uid, nextState);
  if (profile) {
    store.setProfile(uid, profile);
    await store.save();
    onboarding.delete(uid);
    await ctx.reply(t(lang, 'onboarding.sendLocation'), { reply_markup: locationKeyboard(lang) });
  }
});

bot.on('message:location', async (ctx) => {
  const uid = ctx.from.id;
  const profile = store.getProfile(uid);
  if (!profile) {
    await ctx.reply(t('en', 'location.noProfile'));
    return;
  }
  const lang = profile.language;

  const loc = ctx.message.location;
  if (
    !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude) ||
    loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180
  ) {
    await ctx.reply(t(lang, 'location.invalid'));
    return;
  }

  if (!config.testMode) {
    store.removeWaitingByUser(uid);
  }

  const { formedGroups } = store.joinAndMatch(
    {
      telegramUserId: uid,
      chatId: ctx.chat.id,
      displayName: ctx.from.first_name ?? 'User',
      lat: loc.latitude,
      lng: loc.longitude,
      campusId: profile.campusId,
      phone: profile.phone,
      language: profile.language,
    },
    config.groupRadiusKm,
    config.groupSize
  );
  await store.save();

  if (formedGroups.length === 0) {
    await ctx.reply(t(lang, 'location.accepted'));
  }
  await notifyFormed(ctx.api, formedGroups);
});

/** Picks a language for replying to a user (profile, else English). */
function langOf(uid: number): Language {
  return store.getProfile(uid)?.language ?? 'en';
}

bot.command('leave', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();

  await ctx.reply(t(lang, 'leave.confirm') + (result.dissolvedGroup ? t(lang, 'leave.groupDissolved') : ''));
  if (result.dissolvedGroup) {
    for (const m of result.dissolvedGroup.notifiedMembers) {
      await safeSend(ctx.api, m.chatId, t(m.language, 'group.dissolved'));
    }
  }
  await notifyFormed(ctx.api, result.formedGroups);
});

bot.command('status', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  const lines = mine.map(
    (p) => `${p.id}: ${p.status === 'grouped' ? t(lang, 'status.grouped', { group: p.groupId! }) : t(lang, 'status.waiting')}`
  );
  await ctx.reply(t(lang, 'status.header') + '\n' + lines.join('\n'));
});

bot.command('reset', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  for (const p of mine) {
    const result = store.leave(p.id, config.groupRadiusKm, config.groupSize);
    if (result.dissolvedGroup) {
      for (const m of result.dissolvedGroup.notifiedMembers) {
        await safeSend(ctx.api, m.chatId, t(m.language, 'group.dissolved'));
      }
    }
    await notifyFormed(ctx.api, result.formedGroups);
  }
  await store.save();
  await ctx.reply(t(lang, 'reset.done'));
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

const VIEWER_PORT = Number(process.env.PORT) || 8080;
const VIEWER_HOST = process.env.HOST || '127.0.0.1';
const viewer = createViewerServer({
  rebuild: async () => {
    const result = store.rebuild(config.groupRadiusKm, config.groupSize);
    await store.save();
    return result;
  },
});
viewer.on('error', (err) => {
  console.error('Viewer server error (live map disabled):', err instanceof Error ? err.message : err);
});
viewer.listen(VIEWER_PORT, VIEWER_HOST, () => {
  console.log(`✓ Live map at http://${VIEWER_HOST}:${VIEWER_PORT}/live`);
});

console.log('Bot starting (long polling)…');
await bot.start();
```

> Важно про порядок хендлеров grammY: `message:text` для онбординга зарегистрирован до команд не мешает `bot.command(...)`, потому что команды (`/start` и т.п.) — это `message:text` с `entities`, но grammY матчит команды отдельно; чтобы свободный текст онбординга не перехватывал команды, в `message:text` мы вызываем `next()` если пользователь не в онбординге, а во время онбординга пользователь жмёт кнопки-лейблы, не команды. Если это окажется проблемой при ручной проверке — зарегистрировать `bot.command(...)` ВЫШЕ `bot.on('message:text', ...)`.

- [ ] **Step 2: Проверка типов/сборки**

Run: `npm run build`
Expected: компиляция без ошибок (tsc).

- [ ] **Step 3: Прогнать весь тест-набор (регрессий нет)**

Run: `npm test`
Expected: PASS (matcher/store/notify/onboarding/i18n/config/viewer-server).

- [ ] **Step 4: Ручная проверка онбординга**

Запустить `npm run bot`, в Telegram: `/start` → выбрать язык → выбрать кампус → «Поделиться контактом» → отправить геолокацию. Убедиться, что приходит «Локация принята» на выбранном языке. (Деталь верификации; не блокирует коммит, но желательна.)

- [ ] **Step 5: Коммит**

```bash
git add src/bot.ts
git commit -m "feat: onboarding wizard, contact + profile-aware locations, localized replies"
```

---

### Task 7: Живая карта — маркеры кампусов, телефон и кампус

**Files:**
- Modify: `viewer/live.js`
- Modify: `viewer/live.html`

**Interfaces:**
- Consumes: `state.campuses` (массив `{ id, nameKey, lat, lng }`), `participant.phone`, `participant.campusId` из `data/state.json`.
- Produces: визуальные маркеры/попапы (проверяется в браузере).

> i18n названий кампусов на карте: дублировать словарь не нужно — отображаем человекочитаемое имя из карты `CAMPUS_NAMES` по `id` (фиксированные два кампуса). Координаты берём из `state.campuses`.

- [ ] **Step 1: Обновить `viewer/live.js`**

Добавить после `WAITING_COLOR`:

```js
const CAMPUS_COLOR = '#d81b60';
const CAMPUS_NAMES = { mirzo_ulugbek: 'Mirzo Ulugbek', yashnobod: 'Yashnobod' };

function campusName(id) {
  return CAMPUS_NAMES[id] || id;
}
```

В функции `render(state)`, сразу после `const allLatLngs = [];`, отрисовать маркеры кампусов:

```js
  const campuses = state.campuses || [];
  for (const c of campuses) {
    L.marker([c.lat, c.lng], {
      icon: L.divIcon({
        className: 'campus-icon',
        html: '<div class="campus-icon" style="background:' + CAMPUS_COLOR + '">★</div>',
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    }).addTo(layer).bindPopup('<b>' + esc(campusName(c.id)) + '</b><br>кампус');
  }
```

В попапе сгруппированного участника добавить телефон и кампус (заменить существующий `bindPopup` внутри цикла `members`):

```js
      L.circleMarker([p.lat, p.lng], {
        radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95
      }).addTo(layer).bindPopup(
        '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
        '<br>📞 ' + esc(p.phone) +
        '<br>🏫 ' + esc(campusName(p.campusId)) +
        '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
        '<br>Группа: ' + esc(group.groupId)
      );
```

В попапе ожидающего участника добавить то же (заменить `bindPopup` в цикле `waiting`):

```js
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#fff', weight: 1.5, fillColor: WAITING_COLOR, fillOpacity: 0.95
    }).addTo(layer).bindPopup(
      '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
      '<br>📞 ' + esc(p.phone) +
      '<br>🏫 ' + esc(campusName(p.campusId)) +
      '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
      '<br><i>в очереди</i>'
    );
```

В карточке группы (внутри `groups.forEach` для сайдбара) показать кампус и телефоны участников — заменить формирование `card.innerHTML`:

```js
    card.innerHTML =
      '<h2>' + esc(group.groupId) + '</h2>' +
      '<div class="campus">🏫 ' + esc(campusName(members[0] ? members[0].campusId : '')) + '</div>' +
      '<ul>' + members.map((p) => '<li>• ' + esc(p.displayName) + ' — ' + esc(p.phone) + '</li>').join('') + '</ul>';
```

- [ ] **Step 2: Обновить `viewer/live.html`**

Добавить в `<style>` стиль маркера кампуса (рядом с `.centroid-icon`):

```css
    .campus-icon {
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 14px;
      border-radius: 6px; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }
    .group-card .campus { font-size: 11px; color: #b0b0c0; margin-bottom: 4px; }
```

Добавить в легенду (`<div class="legend">`) строку про кампусы:

```html
      <div><span class="dot" style="background:#d81b60"></span>Кампус (★ — пункт назначения)</div>
```

- [ ] **Step 3: Ручная проверка карты**

Запустить `npm run bot`, открыть `http://127.0.0.1:8080/live`. Убедиться: видно два ★-маркера на координатах кампусов; попап участника показывает 📞 и 🏫; карточка группы показывает кампус и телефоны. (Визуальная верификация — посмотреть на страницу.)

- [ ] **Step 4: Коммит**

```bash
git add viewer/live.js viewer/live.html
git commit -m "feat: campus markers, phone and campus on live map"
```

---

### Task 8: Сброс точек и документация

**Files:**
- Modify: `data/state.json`
- Modify: `README.md`

**Interfaces:** нет (данные/документация).

- [ ] **Step 1: Остановить запущенный бот (если работает)**

Бот держит состояние в памяти и перезапишет файл при следующем `save()`, поэтому сброс файла при живом боте не сохранится. Остановить фоновый процесс бота перед сбросом; он перечитает свежий файл при следующем `npm run bot`.

- [ ] **Step 2: Сбросить `data/state.json`**

Записать пустое состояние с кампусами:

```json
{
  "seq": 0,
  "participants": [],
  "groups": [],
  "profiles": {},
  "campuses": [
    { "id": "mirzo_ulugbek", "nameKey": "campus.mirzoUlugbek", "lat": 41.35625, "lng": 69.373209 },
    { "id": "yashnobod", "nameKey": "campus.yashnobod", "lat": 41.256928, "lng": 69.328708 }
  ]
}
```

> Можно также удалить файл — `Store.load` создаст пустое состояние с кампусами автоматически. Явный файл оставлен, чтобы карта сразу показывала кампусы до первого запуска бота.

- [ ] **Step 3: Обновить `README.md`**

В разделе «Что делает проект» / «Команды бота» отразить: онбординг (язык → кампус → телефон → локация), три языка (en/ru/uz, узбекский — латиница), два кампуса с координатами, группировку только внутри кампуса, телефон и кампус на карте, маркеры кампусов. В «Модель данных» добавить поля `campusId`, `phone`, `language` у участника и `profiles`/`campuses` в state. (Конкретный текст — по месту, в стиле существующего README на русском.)

- [ ] **Step 4: Финальная проверка тестов**

Run: `npm test`
Expected: PASS (полный набор).

- [ ] **Step 5: Коммит**

```bash
git add data/state.json README.md
git commit -m "chore: reset state with campuses; document onboarding & i18n"
```

---

## Self-Review

**Spec coverage:**
- Маркеры кампусов на карте → Task 7. ✅
- Координаты кампусов → Task 1 (константы), Task 8 (в state). ✅
- Онбординг: язык/кампус/телефон до локации → Task 5 (логика) + Task 6 (бот). ✅
- 3 языка (en/ru/uz, латиница) → Task 2 + используется в Task 4/6. ✅
- Удалить нынешние точки → Task 8. ✅
- Телефон через requestContact + проверка владельца → Task 6. ✅
- Телефон на /live → Task 7. ✅
- Группировка только внутри кампуса → Task 3 (store.runMatch/rebuild). ✅
- Линию группа→кампус НЕ рисуем → нигде не добавляется. ✅

**Placeholder scan:** код приведён полностью в каждом шаге; единственные «по месту» — текст README (Task 8 Step 3) и опциональная ручная верификация, что допустимо.

**Type consistency:** `Language` определён в `i18n.ts`, реэкспортирован из `types.ts`; `UserProfile` в `types.ts` используется в `store`/`onboarding`/`bot`; `FormedGroup` импортируется из `matcher.ts` (уже экспортирован); `getProfile/setProfile`, `advance/startOnboarding`, `t/LANGUAGES`, `CAMPUSES/campusById` — имена согласованы между задачами. Поля участника `campusId/phone/language` одинаковы в `Participant`, `NewParticipant`, `joinAndMatch`, тестах и карте.
