// BE7: stock movements and stock counts (Epic 2).
//
// - StockMovement: every change of stock, as a signed whole number of units
//   (+ in, − out; for yard products a unit is half a yard). Insert only: a
//   mistake is balanced by another movement, never edited. `flags` is set
//   ONCE when the row is saved (belowZeroOnArrival, clockSkew) and never
//   changed. Types for sales, returns and exchanges are listed now so the
//   sign rule covers them; their operations arrive in BE8 and BE10.
// - StockCount: what was ON THE SHELF when someone counted (Decision 2-5,
//   ADR-24), with what the phone showed then (baseline). Insert only. The
//   difference and "check this count" are WORKED OUT, never stored, so they
//   stay right when other phones' records arrive later.
// - Stock on hand is never stored either: the latest count plus the
//   movements after it (src/services/stockRule.js).
// - Product gains its own low-stock level and on/off switch (Decision 2-2).
// - ProductSize gains a unique key (businessId, productId, id), so a movement
//   or count can point at (product, size) with ONE composite foreign key: the
//   database refuses a size of another product.

// Creates the tables and columns.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    ALTER TABLE Product
      ADD COLUMN lowStockLevelUnits INT NULL AFTER costMinor,
      ADD COLUMN lowStockWarnings BOOLEAN NOT NULL DEFAULT TRUE AFTER lowStockLevelUnits,
      ADD CONSTRAINT ck_product_low_stock CHECK (lowStockLevelUnits IS NULL OR lowStockLevelUnits >= 0)
  `);
  await run('ALTER TABLE ProductSize ADD UNIQUE KEY uq_size_product_id (businessId, productId, id)');

  await run(`
    CREATE TABLE StockMovement (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      locationId CHAR(36) NOT NULL,
      productId CHAR(36) NOT NULL,
      sizeId CHAR(36) NULL,
      quantityUnits INT NOT NULL,
      type ENUM('opening', 'restock', 'sale', 'return_in', 'exchange_in', 'exchange_out', 'removal') NOT NULL,
      reason ENUM('damaged', 'lost', 'supplier_return', 'used', 'other') NULL,
      note VARCHAR(200) NULL,
      saleId CHAR(36) NULL,
      correctionId CHAR(36) NULL,
      flags JSON NOT NULL,
      recordedBy CHAR(36) NOT NULL,
      recordedAt DATETIME(3) NOT NULL,
      receivedAt DATETIME(3) NOT NULL,
      serverSeq BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_movement_business_id (businessId, id),
      UNIQUE KEY uq_stockmovement_seq (businessId, serverSeq),
      KEY ix_movement_stock (businessId, productId, sizeId),
      CONSTRAINT fk_movement_location FOREIGN KEY (businessId, locationId) REFERENCES Location (businessId, id),
      CONSTRAINT fk_movement_product FOREIGN KEY (businessId, productId) REFERENCES Product (businessId, id),
      CONSTRAINT fk_movement_size FOREIGN KEY (businessId, productId, sizeId) REFERENCES ProductSize (businessId, productId, id),
      CONSTRAINT fk_movement_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_movement_sign CHECK (
        (type IN ('opening', 'restock', 'return_in', 'exchange_in') AND quantityUnits > 0)
        OR (type IN ('sale', 'exchange_out', 'removal') AND quantityUnits < 0)
      ),
      CONSTRAINT ck_movement_reason CHECK ((type = 'removal') = (reason IS NOT NULL)),
      CONSTRAINT ck_movement_other_note CHECK (reason IS NULL OR reason <> 'other' OR note IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE StockCount (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      locationId CHAR(36) NOT NULL,
      productId CHAR(36) NOT NULL,
      sizeId CHAR(36) NULL,
      countedUnits INT NOT NULL,
      baselineUnits INT NOT NULL,
      baselineCursor BIGINT UNSIGNED NOT NULL,
      reason ENUM('damaged', 'lost_or_stolen', 'miscounted_before', 'other') NULL,
      note VARCHAR(200) NULL,
      recordedBy CHAR(36) NOT NULL,
      recordedAt DATETIME(3) NOT NULL,
      receivedAt DATETIME(3) NOT NULL,
      serverSeq BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_count_business_id (businessId, id),
      UNIQUE KEY uq_stockcount_seq (businessId, serverSeq),
      KEY ix_count_stock (businessId, productId, sizeId),
      CONSTRAINT fk_count_location FOREIGN KEY (businessId, locationId) REFERENCES Location (businessId, id),
      CONSTRAINT fk_count_product FOREIGN KEY (businessId, productId) REFERENCES Product (businessId, id),
      CONSTRAINT fk_count_size FOREIGN KEY (businessId, productId, sizeId) REFERENCES ProductSize (businessId, productId, id),
      CONSTRAINT fk_count_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_count_not_negative CHECK (countedUnits >= 0),
      CONSTRAINT ck_count_reason CHECK ((countedUnits = baselineUnits) = (reason IS NULL)),
      CONSTRAINT ck_count_other_note CHECK (reason IS NULL OR reason <> 'other' OR note IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Drops them again (development only; production goes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('DROP TABLE StockCount');
  await run('DROP TABLE StockMovement');
  await run('ALTER TABLE ProductSize DROP INDEX uq_size_product_id');
  await run('ALTER TABLE Product DROP CHECK ck_product_low_stock, DROP COLUMN lowStockWarnings, DROP COLUMN lowStockLevelUnits');
}

module.exports = { up, down };
