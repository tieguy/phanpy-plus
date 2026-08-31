import catalogs from './data/catalogs.json';

export const DEFAULT_LANG = 'en';
export const CATALOGS = catalogs;

const locales = [
  DEFAULT_LANG,
  ...catalogs.filter(({ listed }) => listed).map(({ code }) => code),
];
export const LOCALES = locales;

// English-only build: no translation catalogs; the lingui macros render
// their source strings.
export const DEV_LOCALES = [];

export const ALL_LOCALES = locales;
