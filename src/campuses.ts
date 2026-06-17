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
