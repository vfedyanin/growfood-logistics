// Сопоставление имён точек из PDF со справочником Location.
// Стратегия: суффикс «Самокат ГОРОД»/имя точки → канон через таблицу алиасов → точный матч по имени.

// Алиасы: нормализованное имя из PDF → каноническое имя Location в справочнике.
// Пополняется по мере расхождений OCR/справочника (напр. сокращения городов).
export const LOCATION_ALIASES: Record<string, string> = {
  // 'самокат н.новгород': 'Самокат Нижний Новгород',
};

export function normalizeLocName(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

// Резолвер по предзагруженной карте (normalizedName → {id,name}), чтобы не бить в БД по каждой точке.
export function makeResolver(locations: { id: string; name: string }[]) {
  const map = new Map<string, { id: string; name: string }>();
  for (const l of locations) map.set(normalizeLocName(l.name), l);
  return (rawName: string): { id: string; name: string } | null => {
    const canonical = LOCATION_ALIASES[normalizeLocName(rawName)] || rawName;
    return map.get(normalizeLocName(canonical)) || null;
  };
}
