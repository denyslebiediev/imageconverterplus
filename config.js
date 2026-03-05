const LANGUAGES = [
  'en', 'uk', 'zh-Hans', 'ja', 'es', 'pt-BR', 'ko', 'de', 'fr', 'hi',
  'id', 'tr', 'vi', 'ar', 'it', 'zh-Hant', 'nl', 'sv', 'nb', 'da',
  'fi', 'he', 'pl', 'th', 'pt-PT', 'el', 'cs', 'hu', 'ro', 'sk',
  'hr', 'ms', 'ca', 'bn', 'ur', 'fil', 'pa', 'ta', 'te', 'fa',
  'mr', 'gu', 'kn', 'ml', 'af', 'bg', 'sr', 'sl', 'mt', 'ga',
  'sq', 'bs', 'mk', 'is', 'et', 'lv', 'lt', 'sw', 'cy', 'be'
];

const RTL_LANGS = new Set(['ar', 'he', 'ur', 'fa']);

const BASE_URL = 'https://denyslebiediev.github.io/imageconverterplus';

const APP_STORE_LOCALE_MAP = {
  en: 'en-us',
  uk: 'en-us',
  'zh-Hans': 'zh-cn',
  ja: 'ja-jp',
  es: 'es-es',
  'pt-BR': 'pt-br',
  ko: 'ko-kr',
  de: 'de-de',
  fr: 'fr-fr',
  hi: 'en-us',
  id: 'en-us',
  tr: 'tr-tr',
  vi: 'vi-vi',
  ar: 'ar-sa',
  it: 'it-it',
  'zh-Hant': 'zh-tw',
  nl: 'nl-nl',
  sv: 'sv-se',
  nb: 'no-no',
  da: 'da-dk',
  fi: 'fi-fi',
  he: 'he-il',
  pl: 'pl-pl',
  th: 'th-th',
  'pt-PT': 'pt-pt',
  el: 'el-gr',
  cs: 'cs-cz',
  hu: 'hu-hu',
  ro: 'ro-ro',
  sk: 'sk-sk',
  hr: 'hr-hr',
  ms: 'ms-my',
  ca: 'ca-es',
  bn: 'en-us',
  ur: 'en-us',
  fil: 'en-us',
  pa: 'en-us',
  ta: 'en-us',
  te: 'en-us',
  fa: 'en-us',
  mr: 'en-us',
  gu: 'en-us',
  kn: 'en-us',
  ml: 'en-us',
  af: 'en-us',
  bg: 'bg-bg',
  sr: 'en-us',
  sl: 'en-us',
  mt: 'en-us',
  ga: 'en-us',
  sq: 'en-us',
  bs: 'en-us',
  mk: 'en-us',
  is: 'en-us',
  et: 'et-ee',
  lv: 'lv-lv',
  lt: 'lt-lt',
  sw: 'en-us',
  cy: 'en-us',
  be: 'en-us'
};

const PAGES = ['index.html', 'privacy.html', 'terms.html', 'support.html'];

module.exports = { LANGUAGES, RTL_LANGS, BASE_URL, APP_STORE_LOCALE_MAP, PAGES };
