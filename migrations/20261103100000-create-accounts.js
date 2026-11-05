// BE2: the account and business tables (User, Business, BusinessSettings,
// Location, Membership, EmailToken). Written as plain SQL so every rule the
// database itself must enforce is visible here: unique keys, foreign keys,
// CHECK constraints, and the "one active owner per business" rule.
//
// Conventions every later migration follows:
// - IDs are UUIDs in CHAR(36); times are DATETIME(3) in UTC.
// - Every table holding a business's data has `businessId` and a unique key
//   (businessId, id), so other business tables can point at it with a
//   COMPOSITE foreign key (businessId, xId) → (businessId, id): a row can then
//   never point at another business's record, even if the code has a bug.
// - `serverSeq` columns arrive in BE5 with the SyncSequence table.

// Creates the tables in dependency order (a table only refers to ones made before it).
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  // A person with an account. Not business data: one person can belong to
  // several businesses (their own, its practice shop, another shop).
  await run(`
    CREATE TABLE \`User\` (
      id CHAR(36) NOT NULL,
      name VARCHAR(60) NOT NULL,
      phone VARCHAR(13) NOT NULL,
      email VARCHAR(254) NULL,
      emailConfirmedAt DATETIME(3) NULL,
      pendingEmail VARCHAR(254) NULL,
      passwordHash VARCHAR(255) NOT NULL,
      mustChangePassword TINYINT(1) NOT NULL DEFAULT 0,
      language ENUM('en', 'tw') NOT NULL DEFAULT 'en',
      sessionVersion INT UNSIGNED NOT NULL DEFAULT 0,
      termsVersion VARCHAR(20) NULL,
      termsAcceptedAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_phone (phone),
      UNIQUE KEY uq_user_email (email),
      CONSTRAINT ck_user_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 60),
      CONSTRAINT ck_user_phone CHECK (phone REGEXP '^[+]233[0-9]{9}$'),
      CONSTRAINT ck_user_email_lower CHECK (email IS NULL OR email = LOWER(email)),
      CONSTRAINT ck_user_pending_lower CHECK (pendingEmail IS NULL OR pendingEmail = LOWER(pendingEmail)),
      CONSTRAINT ck_user_terms CHECK ((termsVersion IS NULL) = (termsAcceptedAt IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // A business (or a practice shop, which is a second business, BE16). Its
  // name lives in BusinessSettings, the only place it can be changed.
  await run(`
    CREATE TABLE Business (
      id CHAR(36) NOT NULL,
      timezone VARCHAR(40) NOT NULL DEFAULT 'Africa/Accra',
      status ENUM('active', 'closing') NOT NULL DEFAULT 'active',
      isPractice TINYINT(1) NOT NULL DEFAULT 0,
      practiceForBusinessId CHAR(36) NULL,
      closeRequestedAt DATETIME(3) NULL,
      closeRequestedBy CHAR(36) NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_business_practice_for (practiceForBusinessId),
      CONSTRAINT fk_business_practice_for FOREIGN KEY (practiceForBusinessId) REFERENCES Business (id),
      CONSTRAINT fk_business_close_requested_by FOREIGN KEY (closeRequestedBy) REFERENCES \`User\` (id),
      CONSTRAINT ck_business_practice CHECK ((isPractice = 1) = (practiceForBusinessId IS NOT NULL)),
      CONSTRAINT ck_business_closing CHECK ((status = 'closing') = (closeRequestedAt IS NOT NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // One row per business (the one intentional exception to the (businessId, id)
  // key: businessId IS the key). Edited later through settings.update (BE5).
  await run(`
    CREATE TABLE BusinessSettings (
      businessId CHAR(36) NOT NULL,
      businessName VARCHAR(60) NOT NULL,
      receiptPhone VARCHAR(20) NULL,
      receiptNote VARCHAR(120) NULL,
      defaultLanguage ENUM('en', 'tw') NOT NULL DEFAULT 'en',
      lowStockThreshold INT NOT NULL DEFAULT 3,
      returnPeriodDays INT NOT NULL DEFAULT 7,
      defaultCreditLimitPesewas BIGINT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      updatedBy CHAR(36) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (businessId),
      CONSTRAINT fk_settings_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_settings_updated_by FOREIGN KEY (updatedBy) REFERENCES \`User\` (id),
      CONSTRAINT ck_settings_name CHECK (CHAR_LENGTH(TRIM(businessName)) BETWEEN 1 AND 60),
      CONSTRAINT ck_settings_receipt_phone CHECK (receiptPhone IS NULL OR CHAR_LENGTH(receiptPhone) BETWEEN 1 AND 20),
      CONSTRAINT ck_settings_receipt_note CHECK (receiptNote IS NULL OR CHAR_LENGTH(receiptNote) <= 120),
      CONSTRAINT ck_settings_low_stock CHECK (lowStockThreshold >= 0),
      CONSTRAINT ck_settings_return_days CHECK (returnPeriodDays >= 0),
      CONSTRAINT ck_settings_credit_limit CHECK (defaultCreditLimitPesewas IS NULL OR defaultCreditLimitPesewas >= 0),
      CONSTRAINT ck_settings_version CHECK (version >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // A place where the business keeps stock (stage 1: one shop, made at sign-up).
  await run(`
    CREATE TABLE Location (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      name VARCHAR(60) NOT NULL,
      type ENUM('shop', 'warehouse') NOT NULL DEFAULT 'shop',
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_location_business_id (businessId, id),
      CONSTRAINT fk_location_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT ck_location_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 60)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // A person's place in a business, with their role. `activeOwnerBusinessId`
  // is worked out by MySQL itself: the businessId when this row is an ACTIVE
  // OWNER, otherwise NULL. Its unique key means a second active owner for the
  // same business is impossible, whatever the code does. (NULLs don't clash.)
  await run(`
    CREATE TABLE Membership (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      userId CHAR(36) NOT NULL,
      role ENUM('owner', 'manager', 'associate') NOT NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdBy CHAR(36) NOT NULL,
      removedAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      activeOwnerBusinessId CHAR(36) GENERATED ALWAYS AS (IF(role = 'owner' AND isActive = 1, businessId, NULL)) STORED,
      PRIMARY KEY (id),
      UNIQUE KEY uq_membership_business_id (businessId, id),
      UNIQUE KEY uq_membership_business_user (businessId, userId),
      UNIQUE KEY uq_membership_one_active_owner (activeOwnerBusinessId),
      KEY ix_membership_user (userId),
      CONSTRAINT fk_membership_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_membership_user FOREIGN KEY (userId) REFERENCES \`User\` (id),
      CONSTRAINT fk_membership_created_by FOREIGN KEY (createdBy) REFERENCES \`User\` (id),
      CONSTRAINT ck_membership_removed CHECK ((isActive = 1) = (removedAt IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // One-time links sent by email. Only the SHA-256 of the token is stored, so
  // a copy of the database can't be used to open anyone's links. `usedAt`
  // means "no longer usable": used, or replaced by a newer link of the same kind.
  await run(`
    CREATE TABLE EmailToken (
      id CHAR(36) NOT NULL,
      userId CHAR(36) NOT NULL,
      purpose ENUM('confirm_email', 'reset_password', 'change_email') NOT NULL,
      tokenHash CHAR(64) NOT NULL,
      email VARCHAR(254) NOT NULL,
      expiresAt DATETIME(3) NOT NULL,
      usedAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email_token_hash (tokenHash),
      KEY ix_email_token_user_purpose (userId, purpose),
      CONSTRAINT fk_email_token_user FOREIGN KEY (userId) REFERENCES \`User\` (id),
      CONSTRAINT ck_email_token_hash CHECK (tokenHash REGEXP '^[0-9a-f]{64}$'),
      CONSTRAINT ck_email_token_expiry CHECK (expiresAt > createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Removes the tables in reverse order (used only on development and test
// databases; production is fixed forward with a new migration, never undone).
async function down(queryInterface) {
  for (const table of ['EmailToken', 'Membership', 'Location', 'BusinessSettings', 'Business', 'User']) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

module.exports = { up, down };
