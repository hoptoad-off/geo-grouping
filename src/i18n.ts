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
