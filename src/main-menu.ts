/** Which request the user currently has — drives the menu's button set. */
export type RequestState = 'waiting' | 'grouped' | 'none';

/** One reply-keyboard button: a localization key and whether it requests location. */
export interface MenuButton {
  labelKey: string;
  kind: 'text' | 'location';
}

/**
 * Pure layout for the bottom reply keyboard. The location button (a requestLocation
 * button) shows in test mode or when there is no request; in prod a queued user gets
 * a "change location" text button instead, and a grouped user gets neither. Unsubscribe
 * appears only when there is an active request.
 */
export function mainMenuLayout(requestState: RequestState, testMode: boolean): MenuButton[][] {
  const rows: MenuButton[][] = [];

  if (testMode || requestState === 'none') {
    rows.push([{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  } else if (requestState === 'waiting') {
    rows.push([{ labelKey: 'btn.relocate', kind: 'text' }]);
  }

  rows.push([
    { labelKey: 'btn.statusItem', kind: 'text' },
    { labelKey: 'btn.support', kind: 'text' },
  ]);

  const langRow: MenuButton[] = [{ labelKey: 'btn.changeLang', kind: 'text' }];
  if (requestState === 'waiting' || requestState === 'grouped') {
    langRow.push({ labelKey: 'btn.unsubscribe', kind: 'text' });
  }
  rows.push(langRow);

  return rows;
}
