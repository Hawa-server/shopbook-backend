// BE5 Part B: the sync tables.
//
// - SyncSequence: ONE counter per business. Every insert or edit of a synced
//   row takes the next number(s) into that row's `serverSeq`, in the same
//   transaction, always as the LAST step (takeSequence in
//   src/sync/runOperation.js). A phone remembers the highest number it has
//   stored (its cursor) and pulls everything after it.
// - ProcessedOperation: the outcome of every pushed operation, stored in the
//   SAME transaction as its effect, keyed by (businessId, opId). The same
//   operation sent twice is answered from here instead of being applied twice.
// - ReceiptNumber: the receipt registry (used from BE8): one number, once,
//   across sales, corrections and repayments.
// - serverSeq on the synced tables so far: BusinessSettings, Location,
//   Membership, Device. Existing rows are numbered 1, 2, 3… per business and
//   each business's counter starts after them.

// The tables whose rows phones pull, in the order existing rows are numbered.
const SYNCED = ['BusinessSettings', 'Location', 'Membership', 'Device'];

// Creates the tables and columns, numbers the existing rows.
async function up(queryInterface) {
  const run = (sql, options) => queryInterface.sequelize.query(sql, options);

  await run(`
    CREATE TABLE SyncSequence (
      businessId CHAR(36) NOT NULL,
      lastSeq BIGINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (businessId),
      CONSTRAINT fk_sync_sequence_business FOREIGN KEY (businessId) REFERENCES Business (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE ProcessedOperation (
      businessId CHAR(36) NOT NULL,
      opId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      userId CHAR(36) NOT NULL,
      type VARCHAR(40) NOT NULL,
      payloadHash CHAR(64) NOT NULL,
      status ENUM('pending', 'saved', 'rejected') NOT NULL,
      errorCode VARCHAR(40) NULL,
      resultJson JSON NULL,
      processedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (businessId, opId),
      KEY ix_processed_device (businessId, deviceId),
      CONSTRAINT fk_processed_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id),
      CONSTRAINT fk_processed_member FOREIGN KEY (businessId, userId) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_processed_hash CHECK (payloadHash REGEXP '^[0-9a-f]{64}$'),
      CONSTRAINT ck_processed_rejected CHECK ((status = 'rejected') = (errorCode IS NOT NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE ReceiptNumber (
      businessId CHAR(36) NOT NULL,
      receiptNumber VARCHAR(20) NOT NULL,
      recordType ENUM('sale', 'correction', 'repayment') NOT NULL,
      recordId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      PRIMARY KEY (businessId, receiptNumber),
      UNIQUE KEY uq_receipt_record (businessId, recordType, recordId),
      CONSTRAINT fk_receipt_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id),
      CONSTRAINT ck_receipt_format CHECK (receiptNumber REGEXP '^[A-HJKMNP-Z2-46-79]{3,4}-[0-9]{1,9}$')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  for (const table of SYNCED) {
    await run(`ALTER TABLE \`${table}\` ADD COLUMN serverSeq BIGINT UNSIGNED NULL, ADD UNIQUE KEY uq_${table.toLowerCase()}_seq (businessId, serverSeq)`);
  }

  // Number existing rows per business, table by table, then set the counter.
  const [businesses] = await run('SELECT id FROM Business ORDER BY createdAt, id');
  for (const { id } of businesses) {
    let seq = 0;
    for (const table of SYNCED) {
      const [rows] = await run(`SELECT ${table === 'BusinessSettings' ? 'businessId AS rowId' : 'id AS rowId'} FROM \`${table}\` WHERE businessId = ? ORDER BY createdAt`, { replacements: [id] });
      for (const { rowId } of rows) {
        seq += 1;
        const key = table === 'BusinessSettings' ? 'businessId' : 'id';
        await run(`UPDATE \`${table}\` SET serverSeq = ? WHERE businessId = ? AND ${key} = ?`, { replacements: [seq, id, rowId] });
      }
    }
    await run('INSERT INTO SyncSequence (businessId, lastSeq) VALUES (?, ?)', { replacements: [id, seq] });
  }
}

// Undoes it (development and test databases only).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  for (const table of SYNCED) {
    await run(`ALTER TABLE \`${table}\` DROP INDEX uq_${table.toLowerCase()}_seq, DROP COLUMN serverSeq`);
  }
  for (const table of ['ReceiptNumber', 'ProcessedOperation', 'SyncSequence']) {
    await run(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

module.exports = { up, down };
