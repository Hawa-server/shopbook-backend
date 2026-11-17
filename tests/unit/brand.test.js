// Checks that everything a person reads names the product from ONE place
// (src/brand.js): the account emails in every language, and the privacy
// notice and terms. A leftover "Shop Book" (the working name) or an unfilled
// {{productName}} placeholder fails here.

const { PRODUCT_NAME } = require('../../src/brand');
const { renderEmail, TEMPLATE_NAMES } = require('../../src/emails/templates');
const { currentLegal } = require('../../src/legal');

const data = { name: 'Ama', link: 'https://app.example.test/x', newEmailMasked: 'am***@example.test', deviceName: 'Tecno', personName: 'Kofi', businessName: 'Ama Fabrics' };

describe('the product name', () => {
  // Each email, in each language, uses the name and never the working name.
  test.each(TEMPLATE_NAMES.flatMap((t) => ['en', 'tw'].map((l) => [t, l])))('email %s (%s)', (template, language) => {
    const { subject, text } = renderEmail(template, language, data);
    expect(`${subject}\n${text}`).not.toMatch(/Shop Book/);
    if (template !== 'device_added') expect(`${subject}\n${text}`).toContain(PRODUCT_NAME);
  });

  // The legal texts have the name filled in, with no placeholder left.
  test('privacy notice and terms', () => {
    const { documents } = currentLegal();
    for (const language of Object.keys(documents)) {
      for (const text of Object.values(documents[language])) {
        expect(text).toContain(PRODUCT_NAME);
        expect(text).not.toMatch(/Shop Book|\{\{/);
      }
    }
  });
});
