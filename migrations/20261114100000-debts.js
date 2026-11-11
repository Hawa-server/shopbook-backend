// BE9: customers' debts.
//
// - Repayment, DebtWriteOff, OpeningDebt: PERMANENT records. A mistake is
//   fixed by a REVERSAL: a record of the same kind whose corrects…Id points
//   at the original. The database allows only ONE reversal per original
//   (unique key), and the code refuses reversing a reversal.
// - DebtLot, CreditLot, DebtAllocation: the WORKED-OUT view of what each
//   customer owes (server plan "Calculated", ADR-20). Never sent to phones;
//   rebuilt from the permanent records by src/services/debtLots.js.
//
// EXISTING CREDIT SALES (BE8) get their lots HERE, with the SAME rebuild
// code the server uses (debtLots.rebuildFull), one customer at a time, all
// in one transaction: if anything fails, nothing of this migration's data
// step is kept. With only credit sales so far, each customer's balance
// comes out exactly as BE8 cached it; if one ever differs, it's corrected
// and the customer row gets a new sequence number so every phone pulls it.
// Afterwards `npm run check:balances` must find nothing wrong.

const { defineModels } = require('../src/models');
const debtLots = require('../src/services/debtLots');

// The columns every debt record has: who, when, and its sequence number.
const COMMON = `
  recordedBy CHAR(36) NOT NULL,
  recordedAt DATETIME(3) NOT NULL,
  receivedAt DATETIME(3) NOT NULL,
  serverSeq BIGINT UNSIGNED NULL`;

// Creates the tables, then builds every existing customer's lots.
async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;
  const run = (sql, options) => sequelize.query(sql, options);

  await run(`
    CREATE TABLE Repayment (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      customerId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      receiptNumber VARCHAR(20) NOT NULL,
      amountMinor BIGINT NOT NULL,
      method VARCHAR(30) NOT NULL,
      note VARCHAR(200) NULL,
      correctsRepaymentId CHAR(36) NULL,
      correctionReason VARCHAR(200) NULL,
      flags JSON NOT NULL,${COMMON},
      PRIMARY KEY (id),
      UNIQUE KEY uq_repayment_business_id (businessId, id),
      UNIQUE KEY uq_repayment_receipt (businessId, receiptNumber),
      UNIQUE KEY uq_repayment_reversal (businessId, correctsRepaymentId),
      UNIQUE KEY uq_repayment_seq (businessId, serverSeq),
      KEY ix_repayment_customer (businessId, customerId),
      CONSTRAINT fk_repayment_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT fk_repayment_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id),
      CONSTRAINT fk_repayment_original FOREIGN KEY (businessId, correctsRepaymentId) REFERENCES Repayment (businessId, id),
      CONSTRAINT fk_repayment_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_repayment_amount CHECK (amountMinor > 0),
      CONSTRAINT ck_repayment_reason CHECK ((correctsRepaymentId IS NULL) = (correctionReason IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE DebtWriteOff (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      customerId CHAR(36) NOT NULL,
      amountMinor BIGINT NOT NULL,
      reason ENUM('moved', 'died', 'disputed', 'other') NOT NULL,
      note VARCHAR(200) NULL,
      correctsDebtWriteOffId CHAR(36) NULL,
      correctionReason VARCHAR(200) NULL,${COMMON},
      PRIMARY KEY (id),
      UNIQUE KEY uq_writeoff_business_id (businessId, id),
      UNIQUE KEY uq_writeoff_reversal (businessId, correctsDebtWriteOffId),
      UNIQUE KEY uq_debtwriteoff_seq (businessId, serverSeq),
      KEY ix_writeoff_customer (businessId, customerId),
      CONSTRAINT fk_writeoff_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT fk_writeoff_original FOREIGN KEY (businessId, correctsDebtWriteOffId) REFERENCES DebtWriteOff (businessId, id),
      CONSTRAINT fk_writeoff_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_writeoff_amount CHECK (amountMinor > 0),
      CONSTRAINT ck_writeoff_reason CHECK ((correctsDebtWriteOffId IS NULL) = (correctionReason IS NULL)),
      CONSTRAINT ck_writeoff_other_note CHECK (reason <> 'other' OR note IS NOT NULL OR correctsDebtWriteOffId IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE OpeningDebt (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      customerId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      amountMinor BIGINT NOT NULL,
      owedSince DATE NOT NULL,
      note VARCHAR(200) NULL,
      correctsOpeningDebtId CHAR(36) NULL,
      correctionReason VARCHAR(200) NULL,${COMMON},
      PRIMARY KEY (id),
      UNIQUE KEY uq_opening_business_id (businessId, id),
      UNIQUE KEY uq_opening_reversal (businessId, correctsOpeningDebtId),
      UNIQUE KEY uq_openingdebt_seq (businessId, serverSeq),
      KEY ix_opening_customer (businessId, customerId),
      CONSTRAINT fk_opening_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT fk_opening_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id),
      CONSTRAINT fk_opening_original FOREIGN KEY (businessId, correctsOpeningDebtId) REFERENCES OpeningDebt (businessId, id),
      CONSTRAINT fk_opening_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_opening_amount CHECK (amountMinor > 0),
      CONSTRAINT ck_opening_reason CHECK ((correctsOpeningDebtId IS NULL) = (correctionReason IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  const lotTable = (name, types, amountColumn) => run(`
    CREATE TABLE ${name} (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      customerId CHAR(36) NOT NULL,
      sourceType ENUM(${types.map((t) => `'${t}'`).join(', ')}) NOT NULL,
      sourceId CHAR(36) NOT NULL,
      originalMinor BIGINT NOT NULL,
      ${amountColumn} BIGINT NOT NULL,
      effectiveAt DATETIME(3) NOT NULL,
      orderKey VARCHAR(120) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${name.toLowerCase()}_business_id (businessId, id),
      UNIQUE KEY uq_${name.toLowerCase()}_source (businessId, sourceType, sourceId),
      KEY ix_${name.toLowerCase()}_customer (businessId, customerId, orderKey),
      CONSTRAINT fk_${name.toLowerCase()}_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT ck_${name.toLowerCase()}_amounts CHECK (originalMinor > 0 AND ${amountColumn} >= 0 AND ${amountColumn} <= originalMinor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  await lotTable('DebtLot', ['opening_debt', 'credit_sale', 'exchange_credit'], 'outstandingMinor');
  await lotTable('CreditLot', ['repayment_excess', 'write_off_excess', 'return_kept_as_credit', 'return_excess'], 'remainingMinor');

  await run(`
    CREATE TABLE DebtAllocation (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      customerId CHAR(36) NOT NULL,
      debtLotId CHAR(36) NOT NULL,
      sourceType ENUM('repayment', 'write_off', 'return_debt', 'credit_lot') NOT NULL,
      sourceId CHAR(36) NOT NULL,
      amountMinor BIGINT NOT NULL,
      orderKey VARCHAR(120) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_allocation_business_id (businessId, id),
      KEY ix_allocation_customer (businessId, customerId, orderKey),
      CONSTRAINT fk_allocation_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT fk_allocation_lot FOREIGN KEY (businessId, debtLotId) REFERENCES DebtLot (businessId, id),
      CONSTRAINT ck_allocation_amount CHECK (amountMinor > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // The data step: every customer who has a credit sale gets their lots,
  // from the same rebuild code the server runs, in one transaction.
  const models = defineModels(sequelize);
  await sequelize.transaction(async (transaction) => {
    const [customers] = await run(`
      SELECT DISTINCT c.businessId, c.id AS customerId, b.timezone
      FROM Customer c JOIN Business b ON b.id = c.businessId
      JOIN Sale s ON s.businessId = c.businessId AND s.customerId = c.id AND s.creditMinor > 0
      ORDER BY c.businessId, c.id`, { transaction });
    for (const c of customers) {
      const { changed } = await debtLots.rebuildFull(models, transaction, { businessId: c.businessId, customerId: c.customerId, timeZone: c.timezone });
      if (changed) {
        // The cache was corrected: give the customer row a new sequence number.
        await run('UPDATE SyncSequence SET lastSeq = lastSeq + 1 WHERE businessId = ?', { replacements: [c.businessId], transaction });
        await run('UPDATE Customer SET serverSeq = (SELECT lastSeq FROM SyncSequence WHERE businessId = ?) WHERE businessId = ? AND id = ?', {
          replacements: [c.businessId, c.businessId, c.customerId], transaction,
        });
      }
    }
  });
}

// Drops them again (development only; production goes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  for (const table of ['DebtAllocation', 'CreditLot', 'DebtLot', 'OpeningDebt', 'DebtWriteOff', 'Repayment']) await run(`DROP TABLE ${table}`);
}

module.exports = { up, down };
