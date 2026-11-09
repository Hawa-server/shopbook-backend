// The server's reference tables for countries, currencies, languages and
// payment methods (BE4.5, Decision F-27). Shop Book is built to work in any
// country, but a country, language or payment method only exists here once
// everything it needs is ready (legal texts, translations, payment methods).
// Launch: Ghana only; English and Twi.
//
// These are plain data, not database tables: adding a country is a code
// change with tests. The phone receives them from GET /api/reference and
// formats money, dates and phone numbers itself from them.

// Payment methods, by global code. A country lists the ones it offers and
// what each is called there (mobile money is "MoMo" in Ghana).
const { SIZE_RANGES } = require('../catalog/sizeRanges');
const PAYMENT_METHODS = Object.freeze({
  cash: { code: 'cash', name: 'Cash' },
  mobile_money: { code: 'mobile_money', name: 'Mobile money' },
});

// Currencies (ISO 4217). Amounts are always WHOLE numbers of the minor unit
// (pesewas for GHS); `minorUnits` says how many decimals the currency shows.
// The rest says exactly how to write an amount, so every phone shows
// "GH₵ 120.00" the same way (no Intl.NumberFormat, which differs by phone).
const CURRENCIES = Object.freeze({
  GHS: {
    code: 'GHS', name: 'Ghana cedi', symbol: 'GH₵', minorUnits: 2,
    symbolPosition: 'before', symbolSpace: ' ', decimalSeparator: '.', groupSeparator: ',',
  },
});

// Languages (tags in the BCP 47 style). `complete`: every text translated;
// `draft`: some texts still fall back to English. English is the fallback.
const LANGUAGES = Object.freeze({
  en: { tag: 'en', name: 'English', nativeName: 'English', status: 'complete' },
  tw: { tag: 'tw', name: 'Twi', nativeName: 'Twi', status: 'draft' },
});
const FALLBACK_LANGUAGE = 'en';

// Countries (ISO 3166-1 alpha-2) and everything a business there starts with.
// Phone rules: numbers are stored in E.164 (+<dialCode><national number>);
// a local number starts with the trunk prefix (0) and has one of the
// national lengths after it; `mobilePrefixes` (optional) limits it to mobile
// networks.
const COUNTRIES = Object.freeze({
  GH: {
    code: 'GH',
    name: 'Ghana',
    dialCode: '233',
    trunkPrefix: '0',
    nationalNumberLengths: [9],
    mobilePrefixes: ['20', '23', '24', '25', '26', '27', '28', '50', '53', '54', '55', '56', '57', '59'],
    currency: 'GHS',
    timezones: ['Africa/Accra'],
    defaultLanguage: 'en',
    paymentMethods: ['cash', 'mobile_money'],
    paymentMethodNames: { mobile_money: 'MoMo' },
  },
});
const DEFAULT_COUNTRY = 'GH';

// Small lookups used across the server.
const isCountry = (code) => Object.hasOwn(COUNTRIES, code);
const isCurrency = (code) => Object.hasOwn(CURRENCIES, code);
const isLanguage = (tag) => Object.hasOwn(LANGUAGES, tag);
const country = (code) => COUNTRIES[code];
const currency = (code) => CURRENCIES[code];

// What a phone needs to show a business's money: code, symbol, minor units
// and the exact writing rules.
function currencyForPhone(code) {
  const c = CURRENCIES[code];
  return {
    code: c.code, symbol: c.symbol, minorUnits: c.minorUnits, symbolPosition: c.symbolPosition,
    symbolSpace: c.symbolSpace, decimalSeparator: c.decimalSeparator, groupSeparator: c.groupSeparator,
  };
}

// The answer for GET /api/reference: every supported country, currency,
// language and payment method, with the names to show.
function referenceData() {
  return {
    countries: Object.values(COUNTRIES).map((c) => ({
      code: c.code,
      name: c.name,
      dialCode: c.dialCode,
      trunkPrefix: c.trunkPrefix,
      nationalNumberLengths: c.nationalNumberLengths,
      currency: c.currency,
      timezones: c.timezones,
      defaultLanguage: c.defaultLanguage,
      paymentMethods: c.paymentMethods.map((code) => ({ code, name: c.paymentMethodNames[code] ?? PAYMENT_METHODS[code].name })),
    })),
    currencies: Object.values(CURRENCIES).map((c) => ({ ...currencyForPhone(c.code), name: c.name })),
    languages: Object.values(LANGUAGES),
    paymentMethods: Object.values(PAYMENT_METHODS),
    sizeRanges: SIZE_RANGES, // ready-made size ranges (BE6, src/catalog/sizeRanges.js)
    defaults: { country: DEFAULT_COUNTRY, language: FALLBACK_LANGUAGE },
  };
}

module.exports = {
  PAYMENT_METHODS, CURRENCIES, LANGUAGES, COUNTRIES, DEFAULT_COUNTRY, FALLBACK_LANGUAGE,
  isCountry, isCurrency, isLanguage, country, currency, currencyForPhone, referenceData,
};
