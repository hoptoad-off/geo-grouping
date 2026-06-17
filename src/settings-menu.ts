/** Which request the user currently has, drives the status screen's buttons. */
export type RequestState = 'waiting' | 'grouped' | 'none';

/** Settings screens the inline menu can show. */
export type Screen = 'root' | 'status' | 'general' | 'lang';

/** One inline button: a localization key for the label and its callback data. */
export interface MenuButton {
  labelKey: string;
  data: string;
}

/**
 * Pure layout for the inline settings keyboard. Returns rows of buttons (label keys +
 * callback data) for a given screen and the user's current request state. No i18n or
 * Telegram here — the bot renders labels via `t()` and builds the InlineKeyboard.
 */
export function menuScreen(screen: Screen, requestState: RequestState): MenuButton[][] {
  switch (screen) {
    case 'root':
      return [
        [{ labelKey: 'btn.statusItem', data: 's:status' }],
        [{ labelKey: 'btn.general', data: 's:general' }],
      ];
    case 'status': {
      const rows: MenuButton[][] = [];
      if (requestState === 'waiting') {
        rows.push([
          { labelKey: 'btn.relocate', data: 's:relocate' },
          { labelKey: 'btn.unsubscribe', data: 's:leave' },
        ]);
      } else if (requestState === 'grouped') {
        rows.push([{ labelKey: 'btn.unsubscribe', data: 's:leave' }]);
      }
      rows.push([{ labelKey: 'btn.back', data: 's:root' }]);
      return rows;
    }
    case 'general':
      return [
        [{ labelKey: 'btn.support', data: 's:support' }],
        [{ labelKey: 'btn.changeLang', data: 's:lang' }],
        [{ labelKey: 'btn.back', data: 's:root' }],
      ];
    case 'lang':
      return [
        [
          { labelKey: 'lang.en', data: 's:lang:en' },
          { labelKey: 'lang.ru', data: 's:lang:ru' },
          { labelKey: 'lang.uz', data: 's:lang:uz' },
        ],
        [{ labelKey: 'btn.back', data: 's:general' }],
      ];
  }
}
