// Транслитерация названия в код справочника (чип task_f5ab7091).
// Коды заполнялись руками, отсюда дубли и расхождения.

// Таблица сверена с кодами, уже заведёнными в справочниках (28.07.2026):
// х → H, а не KH (TRANSHOLOD ← Трансхолод, HOZ-NUZHDY ← Хоз. Нужды);
// щ → SHCH, а не SCH (PRIEMISHCHE ← Приёмище).
const RU: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z',
  и: 'I', й: 'Y', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R',
  с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'TS', ч: 'CH', ш: 'SH',
  щ: 'SHCH', ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU', я: 'YA',
};

// Юридические формы — в кодах их не пишут: «ООО ПОЛЯНА» → POLYANA
const LEGAL = ['ооо', 'оао', 'зао', 'пао', 'нао', 'ао', 'ип', 'чп', 'тд', 'кф', 'гкфх', 'llc', 'ltd', 'inc'];

// Уточнения в названии, которые в код не идут: «Поляна (произв.)» → POLYANA
const QUALIFIERS = ['произв', 'произ', 'производство', 'филиал'];

export function translit(s: string): string {
  return String(s || '')
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      if (RU[lower] !== undefined) {
        const t = RU[lower];
        return ch === lower ? t.toLowerCase() : t;
      }
      return ch;
    })
    .join('');
}

/**
 * Код из названия: юрформа и инициалы отбрасываются, остальное транслитерируется
 * в верхний регистр, разделитель между словами задаётся параметром.
 *
 * «ООО ПОЛЯНА»          → POLYANA
 * «ИП Сенькова Р.Р.»    → SENKOVA
 * «Королевский Вкус»    → KOROLEVSKIY-VKUS
 * «Поляна (произв.)»    → POLYANA-PROIZV
 */
export function codeFromName(name: string, separator = '-', prefix = ''): string {
  const words = String(name || '')
    .replace(/[«»"'()]/g, ' ')
    .split(/[\s.,/\\]+/)
    .filter(Boolean)
    // юрформа
    .filter((w) => !LEGAL.includes(w.toLowerCase()))
    // уточнения вида «произв.»
    .filter((w) => !QUALIFIERS.includes(w.toLowerCase().replace(/\./g, '')))
    // инициалы вида «Р» или «Р.»: одна буква — не информативно
    .filter((w) => w.replace(/\./g, '').length > 1);

  const body = words
    .map((w) => translit(w).toUpperCase().replace(/[^A-Z0-9]+/g, ''))
    .filter(Boolean)
    .join(separator);

  // Без тела префикс не имеет смысла — оставляем поле пустым, пусть заполнят руками
  if (!body) return '';
  return (prefix + body).slice(0, 40);
}
