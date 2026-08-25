import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const locales = ['ru', 'en'] as const;
export type Locale = typeof locales[number];
export const localeStorageKey = 'netmap.locale';

const messages = {
  ru: {
    'language.label': 'Язык', 'language.ru': 'Русский', 'language.en': 'English',
    'nav.primary': 'Основная навигация', 'nav.map': 'Карта', 'nav.infrastructure': 'Инфраструктура', 'nav.objects': 'Объекты', 'nav.library': 'Библиотека', 'nav.blueprints': 'Шаблоны объектов',
    'health.checking': 'Проверка backend', 'health.healthy': 'Backend доступен', 'health.unavailable': 'Backend недоступен',
    'view.loading.title': 'Загружаем topology projection', 'view.loading.body': 'Подготавливаем логическую схему…', 'view.empty.title': 'В этом scope пока пусто', 'view.empty.body': 'Projection не содержит устройств или связей.', 'view.error.title': 'Не удалось загрузить схему', 'view.error.body': 'Источник topology projection вернул ошибку.', 'action.retry': 'Повторить',
    'catalog.untype': 'Без типа', 'catalog.loading.title': 'Загружаем каталог', 'catalog.loading.body': 'Получаем инвентарный список оборудования и кабелей…', 'catalog.error.title': 'Не удалось загрузить каталог',
  },
  en: {
    'language.label': 'Language', 'language.ru': 'Русский', 'language.en': 'English',
    'nav.primary': 'Primary navigation', 'nav.map': 'Map', 'nav.infrastructure': 'Infrastructure', 'nav.objects': 'Objects', 'nav.library': 'Library', 'nav.blueprints': 'Object blueprints',
    'health.checking': 'Checking backend', 'health.healthy': 'Backend available', 'health.unavailable': 'Backend unavailable',
    'view.loading.title': 'Loading topology projection', 'view.loading.body': 'Preparing the logical topology…', 'view.empty.title': 'Nothing in this scope yet', 'view.empty.body': 'The projection contains no devices or connections.', 'view.error.title': 'Could not load topology', 'view.error.body': 'The topology projection source returned an error.', 'action.retry': 'Retry',
    'catalog.untype': 'No type', 'catalog.loading.title': 'Loading catalog', 'catalog.loading.body': 'Loading the equipment and cable inventory…', 'catalog.error.title': 'Could not load catalog',
  },
} as const;

/* Existing routed surfaces predate the boundary and contain presentation-only
 * Russian literals.  Keeping their source text here lets the provider migrate
 * them atomically without touching canonical DTO fields or API tokens. */
const legacyEnglish: Record<string, string> = {
  'Физическая': 'Physical', 'Логическая': 'Logical', 'Карты': 'Maps', 'Создать карту': 'Create map', 'Удалить карту': 'Delete map', 'Создайте первую карту': 'Create your first map', 'Добавить на карту': 'Add to map', 'Повторить': 'Retry', 'Отмена': 'Cancel', 'Сохранить': 'Save', 'Удалить': 'Delete', 'Редактировать': 'Edit', 'Создать': 'Create',
  'Каталог': 'Catalog', 'Оборудование': 'Equipment', 'Кабели': 'Cables', 'Поиск': 'Search', 'Тип': 'Type', 'Карта': 'Map', 'Порты': 'Ports', 'Состояние': 'Status', 'Название': 'Name', 'Действия': 'Actions', 'Все': 'All', 'Без типа': 'No type', 'Без карты': 'No map', 'Все карты': 'All maps', 'Есть подключения': 'Has connections', 'Есть свободные порты': 'Has free ports', 'Все порты заняты': 'All ports are occupied', 'Состояние неизвестно': 'Status unknown', 'Разрешённые': 'Resolved', 'Неоднозначные': 'Unresolved', 'Состояние не определено': 'Status unavailable', 'Нет': 'No',
  'Быстрый инспектор': 'Quick inspector', 'Закрыть инспектор': 'Close inspector', 'Технические детали': 'Technical details', 'Открыть объект': 'Open object', 'Убрать с карты': 'Remove from map', 'Дополнительные действия': 'Additional actions', 'Трасса на карте': 'Route on map', 'Редактировать трассу': 'Edit route', 'Сохранить трассу': 'Save route', 'Сбросить трассу': 'Reset route', 'Отменить': 'Cancel',
  'Откуда': 'From', 'Куда': 'To', 'Порт источника': 'Source port', 'Порт назначения': 'Destination port', 'Любой порт': 'Any port', 'Трассировать': 'Trace', 'Сбросить трассировку': 'Clear trace', 'Показать альтернативу': 'Show alternative', 'Доказанных альтернатив:': 'Proven alternatives:',
  'Инфраструктура': 'Infrastructure', 'Создать объект': 'Create object', 'Создать вручную': 'Create manually', 'Сетевое устройство': 'Network device', 'Физический объект': 'Physical object', 'Шаблоны объектов': 'Object blueprints', 'Выбрать шаблон': 'Select blueprint', 'Создать первый шаблон': 'Create first blueprint',
  'Библиотека': 'Library', 'Создать шаблон': 'Create blueprint', 'Новый шаблон': 'New blueprint', 'Редактирование': 'Editing', 'Редактировать шаблон объекта': 'Edit object blueprint', 'Создать шаблон объекта': 'Create object blueprint', 'Предпросмотр схемы': 'Blueprint preview', 'Уменьшить масштаб': 'Zoom out', 'Увеличить масштаб': 'Zoom in', 'Сбросить масштаб': 'Reset zoom', 'Вписать': 'Fit', 'Добавить группу портов': 'Add port group', 'Удалить группу': 'Delete group', 'Внутренние пары портов': 'Internal port pairs', 'Индивидуальные внутренние связи': 'Individual internal links', 'Добавить индивидуальную связь': 'Add individual link',
  'Левая': 'Left', 'Правая': 'Right', 'Верхняя': 'Top', 'Нижняя': 'Bottom', 'Настроено': 'Configured', 'Работает': 'Active', 'Неактивно': 'Inactive', 'Недоступно': 'Unavailable', 'Статус неизвестен': 'Status unknown', 'Нет данных': 'No data', 'ПК': 'Workstation', 'КОММУТАТОР': 'Switch', 'КАБЕЛЬ': 'Cable', 'РОЗЕТКА': 'Outlet', 'ПАТЧ-ПАНЕЛЬ': 'Patch panel',
};

export type MessageKey = keyof typeof messages.ru;
export const readStoredLocale = (storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): Locale => {
  const value = storage?.getItem(localeStorageKey);
  return locales.includes(value as Locale) ? value as Locale : 'ru';
};

type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, values?: Record<string, string | number>) => string; collator: Intl.Collator };
const format = (message: string, values?: Record<string, string | number>) => message.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? `{${name}}`));
const defaultI18n: I18n = { locale: 'ru', setLocale: () => undefined, t: (key, values) => format(messages.ru[key], values), collator: new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }) };
const I18nContext = createContext<I18n>(defaultI18n);
const legacySource = new WeakMap<Text, string>();

function translateLegacy(root: HTMLElement, locale: Locale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const source = legacySource.get(node) ?? node.textContent ?? '';
    legacySource.set(node, source);
    const translated = locale === 'en' ? (legacyEnglish[source] ?? source) : source;
    if (node.textContent !== translated) node.textContent = translated;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  useEffect(() => { document.documentElement.lang = locale; window.localStorage.setItem(localeStorageKey, locale); }, [locale]);
  useEffect(() => {
    const root = document.getElementById('root'); if (!root) return;
    translateLegacy(root, locale);
    const observer = new MutationObserver(() => translateLegacy(root, locale));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);
  const value = useMemo<I18n>(() => ({ locale, setLocale, t: (key, values) => format(messages[locale][key], values), collator: new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18n { return useContext(I18nContext); }
