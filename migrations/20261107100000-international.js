// BE4.5: international-ready (Decision F-27; launch Ghana only).
//
// - Business gains `country` (ISO 3166, e.g. GH) and `currency` (ISO 4217,
//   e.g. GHS), and `moneyRecordedAt`: the moment its first money record was
//   saved (set from BE7/BE8 on). From then on country, currency and time
//   zone are locked (409 CURRENCY_LOCKED). Existing businesses become
//   GH / GHS, exactly what they already are.
// - Languages become open tags (VARCHAR) instead of ENUM('en','tw'); the
//   server's language table says which ones are supported. Values are kept.
// - Phone numbers: any country in E.164 (+<country code><number>, 7–15
//   digits) instead of only +233. Existing +233 numbers already fit.
// - Money columns are named …Minor (whole minor units of the business's
//   currency), so defaultCreditLimitPesewas becomes defaultCreditLimitMinor.
// - BusinessSettings gains `paymentMethods`: the methods this business uses
//   (existing: cash and mobile money).

const LANGUAGE_TAG = "'^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'";

// Applies every change; each new required column is added empty, filled for
// existing rows, then made required.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    ALTER TABLE Business
      ADD COLUMN country CHAR(2) NULL AFTER id,
      ADD COLUMN currency CHAR(3) NULL AFTER country,
      ADD COLUMN moneyRecordedAt DATETIME(3) NULL AFTER timezone
  `);
  await run("UPDATE Business SET country = 'GH', currency = 'GHS' WHERE country IS NULL");
  await run(`
    ALTER TABLE Business
      MODIFY country CHAR(2) NOT NULL,
      MODIFY currency CHAR(3) NOT NULL,
      ADD CONSTRAINT ck_business_country CHECK (country REGEXP '^[A-Z]{2}$'),
      ADD CONSTRAINT ck_business_currency CHECK (currency REGEXP '^[A-Z]{3}$'),
      ADD CONSTRAINT ck_business_timezone CHECK (CHAR_LENGTH(timezone) BETWEEN 3 AND 40)
  `);

  await run(`
    ALTER TABLE \`User\`
      MODIFY language VARCHAR(16) NOT NULL DEFAULT 'en',
      DROP CHECK ck_user_phone,
      ADD CONSTRAINT ck_user_phone CHECK (phone REGEXP '^[+][1-9][0-9]{6,14}$'),
      ADD CONSTRAINT ck_user_language CHECK (language REGEXP ${LANGUAGE_TAG})
  `);
  await run('ALTER TABLE `User` MODIFY phone VARCHAR(16) NOT NULL');

  await run(`
    ALTER TABLE BusinessSettings
      MODIFY defaultLanguage VARCHAR(16) NOT NULL DEFAULT 'en',
      ADD CONSTRAINT ck_settings_language CHECK (defaultLanguage REGEXP ${LANGUAGE_TAG}),
      DROP CHECK ck_settings_credit_limit,
      RENAME COLUMN defaultCreditLimitPesewas TO defaultCreditLimitMinor,
      ADD COLUMN paymentMethods JSON NULL AFTER receiptNote
  `);
  await run(`
    ALTER TABLE BusinessSettings
      ADD CONSTRAINT ck_settings_credit_limit CHECK (defaultCreditLimitMinor IS NULL OR defaultCreditLimitMinor >= 0)
  `);
  await run(`UPDATE BusinessSettings SET paymentMethods = JSON_ARRAY('cash', 'mobile_money') WHERE paymentMethods IS NULL`);
  await run(`
    ALTER TABLE BusinessSettings
      MODIFY paymentMethods JSON NOT NULL,
      ADD CONSTRAINT ck_settings_payment_methods CHECK (JSON_TYPE(paymentMethods) = 'ARRAY' AND JSON_LENGTH(paymentMethods) >= 1)
  `);
}

// Undoes it (development and test databases only; production fixes forward).
// It fails on purpose if a non-Ghana number or a language other than en/tw
// was saved since.
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run(`
    ALTER TABLE BusinessSettings
      DROP CHECK ck_settings_payment_methods,
      DROP COLUMN paymentMethods,
      DROP CHECK ck_settings_credit_limit,
      DROP CHECK ck_settings_language
  `);
  await run(`
    ALTER TABLE BusinessSettings
      RENAME COLUMN defaultCreditLimitMinor TO defaultCreditLimitPesewas,
      MODIFY defaultLanguage ENUM('en', 'tw') NOT NULL DEFAULT 'en',
      ADD CONSTRAINT ck_settings_credit_limit CHECK (defaultCreditLimitPesewas IS NULL OR defaultCreditLimitPesewas >= 0)
  `);
  await run(`
    ALTER TABLE \`User\`
      DROP CHECK ck_user_language,
      DROP CHECK ck_user_phone,
      MODIFY language ENUM('en', 'tw') NOT NULL DEFAULT 'en',
      MODIFY phone VARCHAR(13) NOT NULL,
      ADD CONSTRAINT ck_user_phone CHECK (phone REGEXP '^[+]233[0-9]{9}$')
  `);
  await run(`
    ALTER TABLE Business
      DROP CHECK ck_business_timezone,
      DROP CHECK ck_business_currency,
      DROP CHECK ck_business_country,
      DROP COLUMN moneyRecordedAt,
      DROP COLUMN currency,
      DROP COLUMN country
  `);
}

module.exports = { up, down };
