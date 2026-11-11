// BE8: sales (Epic 3A) and the customers that credit sales need.
//
// - Customer: a person who buys (on credit, or whose history the shop
//   keeps). `balanceMinor` and `oldestUnpaidAt` are a CACHE worked out by the
//   server in the same transaction as every sale; phones never send them,
//   and check:balances rebuilds them from the sales to prove they're right.
//   In BE8 customers are only created; editing them (and credit limits)
//   arrives with BE9.
// - Sale, SaleItem, SalePayment: PERMANENT records, inserted once, never
//   changed or deleted. A mistake is fixed by a correction (BE10). Each line
//   keeps a COPY of the product name, size, unit and unitScale as they were,
//   so a later product change never changes an old receipt.
// - The database guards the totals too: credit = subtotal − paid, never
//   below zero, and credit only with a customer; a changed price needs a note.
// - StockMovement.saleId now points at its sale (composite foreign key), and
//   only a `sale` movement may have one.

// Creates the tables and keys.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    CREATE TABLE Customer (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      name VARCHAR(60) NOT NULL,
      nameNormalized VARCHAR(60) NOT NULL,
      phone VARCHAR(16) NULL,
      language VARCHAR(16) NOT NULL,
      isHidden BOOLEAN NOT NULL DEFAULT FALSE,
      creditLimitMinor BIGINT NULL,
      balanceMinor BIGINT NOT NULL DEFAULT 0,
      oldestUnpaidAt DATETIME(3) NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      createdBy CHAR(36) NOT NULL,
      updatedBy CHAR(36) NULL,
      serverSeq BIGINT UNSIGNED NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_business_id (businessId, id),
      UNIQUE KEY uq_customer_seq (businessId, serverSeq),
      KEY ix_customer_name (businessId, nameNormalized),
      CONSTRAINT fk_customer_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_customer_created_by FOREIGN KEY (businessId, createdBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT fk_customer_updated_by FOREIGN KEY (businessId, updatedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_customer_limit CHECK (creditLimitMinor IS NULL OR creditLimitMinor >= 0),
      CONSTRAINT ck_customer_version CHECK (version >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE Sale (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      locationId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      receiptNumber VARCHAR(20) NOT NULL,
      customerId CHAR(36) NULL,
      priceType ENUM('retail', 'wholesale') NOT NULL,
      subtotalMinor BIGINT NOT NULL,
      paidMinor BIGINT NOT NULL,
      creditMinor BIGINT NOT NULL,
      flags JSON NOT NULL,
      recordedBy CHAR(36) NOT NULL,
      recordedAt DATETIME(3) NOT NULL,
      receivedAt DATETIME(3) NOT NULL,
      serverSeq BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sale_business_id (businessId, id),
      UNIQUE KEY uq_sale_receipt (businessId, receiptNumber),
      UNIQUE KEY uq_sale_seq (businessId, serverSeq),
      KEY ix_sale_customer (businessId, customerId),
      KEY ix_sale_recorded (businessId, recordedAt),
      CONSTRAINT fk_sale_location FOREIGN KEY (businessId, locationId) REFERENCES Location (businessId, id),
      CONSTRAINT fk_sale_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id),
      CONSTRAINT fk_sale_customer FOREIGN KEY (businessId, customerId) REFERENCES Customer (businessId, id),
      CONSTRAINT fk_sale_recorded_by FOREIGN KEY (businessId, recordedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_sale_amounts CHECK (subtotalMinor >= 0 AND paidMinor >= 0 AND creditMinor >= 0),
      CONSTRAINT ck_sale_credit CHECK (creditMinor = subtotalMinor - paidMinor),
      CONSTRAINT ck_sale_credit_customer CHECK (creditMinor = 0 OR customerId IS NOT NULL)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE SaleItem (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      saleId CHAR(36) NOT NULL,
      productId CHAR(36) NOT NULL,
      sizeId CHAR(36) NULL,
      productName VARCHAR(80) NOT NULL,
      sizeLabel VARCHAR(20) NULL,
      unit ENUM('piece', 'pair', 'set', 'dozen', 'yard', 'custom') NOT NULL,
      unitLabel VARCHAR(20) NULL,
      unitScale TINYINT UNSIGNED NOT NULL,
      quantityUnits INT NOT NULL,
      productVersion INT UNSIGNED NOT NULL,
      sizeVersion INT UNSIGNED NULL,
      setPriceMinor BIGINT NOT NULL,
      agreedPriceMinor BIGINT NOT NULL,
      lineTotalMinor BIGINT NOT NULL,
      priceNote VARCHAR(200) NULL,
      unitCostMinor BIGINT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sale_item_business_id (businessId, id),
      KEY ix_sale_item_sale (businessId, saleId),
      CONSTRAINT fk_sale_item_sale FOREIGN KEY (businessId, saleId) REFERENCES Sale (businessId, id),
      CONSTRAINT fk_sale_item_product FOREIGN KEY (businessId, productId) REFERENCES Product (businessId, id),
      CONSTRAINT fk_sale_item_size FOREIGN KEY (businessId, productId, sizeId) REFERENCES ProductSize (businessId, productId, id),
      CONSTRAINT ck_sale_item_quantity CHECK (quantityUnits > 0),
      CONSTRAINT ck_sale_item_prices CHECK (setPriceMinor >= 0 AND agreedPriceMinor >= 0 AND lineTotalMinor >= 0),
      CONSTRAINT ck_sale_item_note CHECK (agreedPriceMinor = setPriceMinor OR priceNote IS NOT NULL),
      CONSTRAINT ck_sale_item_size_version CHECK ((sizeId IS NULL) = (sizeVersion IS NULL)),
      CONSTRAINT ck_sale_item_scale CHECK (unitScale IN (1, 2))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE SalePayment (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      saleId CHAR(36) NOT NULL,
      method VARCHAR(30) NOT NULL,
      amountMinor BIGINT NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sale_payment_business_id (businessId, id),
      UNIQUE KEY uq_sale_payment_method (businessId, saleId, method),
      CONSTRAINT fk_sale_payment_sale FOREIGN KEY (businessId, saleId) REFERENCES Sale (businessId, id),
      CONSTRAINT ck_sale_payment_amount CHECK (amountMinor > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    ALTER TABLE StockMovement
      ADD CONSTRAINT fk_movement_sale FOREIGN KEY (businessId, saleId) REFERENCES Sale (businessId, id),
      ADD CONSTRAINT ck_movement_sale_link CHECK ((type = 'sale') = (saleId IS NOT NULL))
  `);
}

// Drops them again (development only; production goes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('ALTER TABLE StockMovement DROP CHECK ck_movement_sale_link, DROP FOREIGN KEY fk_movement_sale');
  await run('DROP TABLE SalePayment');
  await run('DROP TABLE SaleItem');
  await run('DROP TABLE Sale');
  await run('DROP TABLE Customer');
}

module.exports = { up, down };
