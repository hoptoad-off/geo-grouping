import { Bot, Keyboard } from 'grammy';
import type { Api, RawApi } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers } from './store.js';
import { formatGroupFormed, safeSend } from './notify.js';
import { createViewerServer } from './viewer-server.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

const locationKeyboard = new Keyboard()
  .requestLocation('📍 Отправить геолокацию')
  .resized();

/** Notifies every member of each freshly formed group, from their own perspective. */
async function notifyFormed(api: Api<RawApi>, formed: GroupWithMembers[]): Promise<void> {
  for (const { members } of formed) {
    for (const member of members) {
      await safeSend(api, member.chatId, formatGroupFormed(members, member));
    }
  }
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Привет! Отправьте свою геолокацию кнопкой ниже, и я подберу вам группу из 3 человек поблизости.\n\n' +
      'Команды:\n/leave — выйти\n/status — мой статус\n/reset — удалить все мои локации',
    { reply_markup: locationKeyboard }
  );
});

bot.on('message:location', async (ctx) => {
  const loc = ctx.message.location;
  if (
    !Number.isFinite(loc.latitude) ||
    !Number.isFinite(loc.longitude) ||
    loc.latitude < -90 ||
    loc.latitude > 90 ||
    loc.longitude < -180 ||
    loc.longitude > 180
  ) {
    await ctx.reply('Не удалось распознать координаты, попробуйте ещё раз.');
    return;
  }

  const uid = ctx.from.id;
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
    },
    config.groupRadiusKm,
    config.groupSize
  );
  await store.save();

  if (formedGroups.length === 0) {
    await ctx.reply('📍 Локация принята! Ищем для вас группу…');
  }
  await notifyFormed(ctx.api, formedGroups);
});

bot.command('leave', async (ctx) => {
  const mine = store.participantsByUser(ctx.from!.id);
  if (mine.length === 0) {
    await ctx.reply('У вас нет активных локаций.');
    return;
  }
  const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();

  await ctx.reply('Вы вышли.' + (result.dissolvedGroup ? ' Ваша группа распущена.' : ''));
  if (result.dissolvedGroup) {
    for (const m of result.dissolvedGroup.notifiedMembers) {
      await safeSend(ctx.api, m.chatId, '⚠️ Группа распалась. Ищем для вас новую…');
    }
  }
  await notifyFormed(ctx.api, result.formedGroups);
});

bot.command('status', async (ctx) => {
  const mine = store.participantsByUser(ctx.from!.id);
  if (mine.length === 0) {
    await ctx.reply('У вас нет активных локаций. Отправьте геолокацию, чтобы начать.');
    return;
  }
  const lines = mine.map(
    (p) => `${p.id}: ${p.status === 'grouped' ? `в группе ${p.groupId}` : 'в очереди'}`
  );
  await ctx.reply('Ваш статус:\n' + lines.join('\n'));
});

bot.command('reset', async (ctx) => {
  const mine = store.participantsByUser(ctx.from!.id);
  if (mine.length === 0) {
    await ctx.reply('У вас нет активных локаций.');
    return;
  }
  for (const p of mine) {
    const result = store.leave(p.id, config.groupRadiusKm, config.groupSize);
    if (result.dissolvedGroup) {
      for (const m of result.dissolvedGroup.notifiedMembers) {
        await safeSend(ctx.api, m.chatId, '⚠️ Группа распалась. Ищем для вас новую…');
      }
    }
    await notifyFormed(ctx.api, result.formedGroups);
  }
  await store.save();
  await ctx.reply('Все ваши локации удалены.');
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
