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

export type MessageKey = keyof typeof messages.ru;
export const readStoredLocale = (storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): Locale => {
  const value = storage?.getItem(localeStorageKey);
  return locales.includes(value as Locale) ? value as Locale : 'ru';
};

type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, values?: Record<string, string | number>) => string; collator: Intl.Collator };
const format = (message: string, values?: Record<string, string | number>) => message.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? `{${name}}`));
const defaultI18n: I18n = { locale: 'ru', setLocale: () => undefined, t: (key, values) => format(messages.ru[key], values), collator: new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }) };
const I18nContext = createContext<I18n>(defaultI18n);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  useEffect(() => { document.documentElement.lang = locale; window.localStorage.setItem(localeStorageKey, locale); }, [locale]);
  const value = useMemo<I18n>(() => ({ locale, setLocale, t: (key, values) => format(messages[locale][key], values), collator: new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18n { return useContext(I18nContext); }
