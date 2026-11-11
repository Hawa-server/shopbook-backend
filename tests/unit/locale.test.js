// BE4.5 unit tests: phone numbers in E.164 by country, writing money from the
// currency table (integers only), the reference data, and payment methods.

const { normalizePhone } = require('../../src/lib/phone');
const { formatMoney } = require('../../src/locale/money');
const locale = require('../../src/locale');

describe('normalizePhone (E.164, launch: Ghana)', () => {
  test.each([
    ['0241234567', '+233241234567'],
    ['024 123 4567', '+233241234567'],
    ['024-123-4567', '+233241234567'],
    ['241234567', '+233241234567'],
    ['+233241234567', '+233241234567'],
    ['+233 24 123 4567', '+233241234567'],
    ['233241234567', '+233241234567'],
    ['00233241234567', '+233241234567'],
    ['(020) 123 4567', '+233201234567'],
  ])('%p (local numbers read as Ghana) → %p', (input, expected) => {
    expect(normalizePhone(input, 'GH')).toBe(expected);
    expect(normalizePhone(input)).toBe(expected); // Ghana is the default
  });

  test.each([
    ['a Ghana landline (030…)', '0302123456'],
    ['too short', '024123456'],
    ['too long', '02412345678'],
    ['a country not supported yet (UK)', '+447911123456'],
    ['a country not supported yet (Nigeria)', '+2348031234567'],
    ['letters', '024ABC4567'],
    ['empty', ''],
    ['not a string', 241234567],
  ])('refuses %s', (_label, input) => {
    expect(normalizePhone(input, 'GH')).toBeNull();
  });

  test('an unsupported country for local numbers gives null', () => {
    expect(normalizePhone('08031234567', 'NG')).toBeNull();
  });
});

describe('formatMoney (whole minor units → "GH₵ 120.00")', () => {
  const NBSP = ' ';
  test.each([
    [12000, `GH₵${NBSP}120.00`],
    [120050, `GH₵${NBSP}1,200.50`],
    [5, `GH₵${NBSP}0.05`],
    [0, `GH₵${NBSP}0.00`],
    [-500, `-GH₵${NBSP}5.00`],
    [123456789, `GH₵${NBSP}1,234,567.89`],
  ])('%p pesewas → %p', (minor, text) => {
    expect(formatMoney(minor, 'GHS')).toBe(text);
  });

  test('refuses decimals (no floating-point money) and unknown currencies', () => {
    expect(() => formatMoney(120.5, 'GHS')).toThrow(TypeError);
    expect(() => formatMoney(100, 'USD')).toThrow(RangeError);
  });
});

describe('the reference data', () => {
  test('launch: Ghana, GHS (2 decimals), English and Twi, cash and MoMo', () => {
    const data = locale.referenceData();
    expect(data.countries).toEqual([{
      code: 'GH', name: 'Ghana', dialCode: '233', trunkPrefix: '0', nationalNumberLengths: [9],
      currency: 'GHS', timezones: ['Africa/Accra'], defaultLanguage: 'en',
      paymentMethods: [{ code: 'cash', name: 'Cash' }, { code: 'mobile_money', name: 'MoMo' }],
    }]);
    expect(data.currencies).toEqual([{
      code: 'GHS', name: 'Ghana cedi', symbol: 'GH₵', minorUnits: 2, symbolPosition: 'before',
      symbolSpace: ' ', decimalSeparator: '.', groupSeparator: ',',
    }]);
    expect(data.languages.map((l) => [l.tag, l.status])).toEqual([['en', 'complete'], ['tw', 'draft']]);
    expect(data.paymentMethods.map((p) => p.code)).toEqual(['cash', 'mobile_money']);
    expect(data.defaults).toEqual({ country: 'GH', language: 'en' });
  });
});
