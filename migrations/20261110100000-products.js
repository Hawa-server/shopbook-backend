// BE6: products, sizes and their price history.
//
// - Product: what a shop sells, with its retail, wholesale and cost prices in
//   whole minor units of the business's currency. `nameNormalized` (trimmed,
//   single spaces, lower case) is INDEXED but NOT unique: two phones may add
//   the same name offline and may each have sold it already, so both are
//   kept and the later one gets a warning (decided 8 Nov 2026).
// - ProductSize: one row per size (30, 31…; S, M, L), in `sortOrder`. A
//   size's own price may be NULL, meaning "use the product's".
// - PriceVersion: SERVER-ONLY history, insert only, never pulled. One row per
//   accepted product or size change: the prices and cost as they were in that
//   version, so a sale (BE8) can be checked against the price the phone
//   really showed and costed from the same moment. A product's own prices
//   have sizeId NULL; MySQL can't put a NULL column in a primary key, so the
//   key is an ordinary id plus a UNIQUE key on (businessId, productId,
//   sizeKey, version), where sizeKey is a generated column: the sizeId, or ''.
//
// Every table has the (businessId, id) key and composite foreign keys, so a
// row can never point at another business's product or person.
//
// ChangeLog also gains `seq` (AUTO_INCREMENT): the order rows were written.
// History is shown in that order; `changedAt` alone can't order two changes
// made in the same millisecond.

// Creates the three tables, and ChangeLog's write order.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run('ALTER TABLE ChangeLog ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_changelog_seq (seq)');

  await run(`
    CREATE TABLE Product (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      name VARCHAR(80) NOT NULL,
      nameNormalized VARCHAR(80) NOT NULL,
      type ENUM('clothing', 'shoes', 'fabric', 'other') NOT NULL,
      unit ENUM('piece', 'pair', 'set', 'dozen', 'yard', 'custom') NOT NULL,
      unitLabel VARCHAR(20) NULL,
      unitScale TINYINT UNSIGNED NOT NULL,
      retailMinor BIGINT NOT NULL,
      wholesaleMinor BIGINT NULL,
      costMinor BIGINT NULL,
      isHidden BOOLEAN NOT NULL DEFAULT FALSE,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      createdBy CHAR(36) NOT NULL,
      updatedBy CHAR(36) NULL,
      serverSeq BIGINT UNSIGNED NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_product_business_id (businessId, id),
      UNIQUE KEY uq_product_seq (businessId, serverSeq),
      KEY ix_product_name (businessId, nameNormalized),
      CONSTRAINT fk_product_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_product_created_by FOREIGN KEY (businessId, createdBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT fk_product_updated_by FOREIGN KEY (businessId, updatedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_product_retail CHECK (retailMinor > 0),
      CONSTRAINT ck_product_wholesale CHECK (wholesaleMinor IS NULL OR wholesaleMinor > 0),
      CONSTRAINT ck_product_cost CHECK (costMinor IS NULL OR costMinor > 0),
      CONSTRAINT ck_product_unit_scale CHECK (unitScale = IF(unit = 'yard', 2, 1)),
      CONSTRAINT ck_product_unit_label CHECK ((unit = 'custom') = (unitLabel IS NOT NULL)),
      CONSTRAINT ck_product_fabric_unit CHECK (type <> 'fabric' OR unit IN ('piece', 'yard')),
      CONSTRAINT ck_product_version CHECK (version >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE ProductSize (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      productId CHAR(36) NOT NULL,
      label VARCHAR(20) NOT NULL,
      labelNormalized VARCHAR(20) NOT NULL,
      sortOrder INT NOT NULL,
      retailMinor BIGINT NULL,
      wholesaleMinor BIGINT NULL,
      costMinor BIGINT NULL,
      isActive BOOLEAN NOT NULL DEFAULT TRUE,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      createdBy CHAR(36) NOT NULL,
      updatedBy CHAR(36) NULL,
      serverSeq BIGINT UNSIGNED NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_size_business_id (businessId, id),
      UNIQUE KEY uq_productsize_seq (businessId, serverSeq),
      KEY ix_size_product (businessId, productId, labelNormalized),
      CONSTRAINT fk_size_product FOREIGN KEY (businessId, productId) REFERENCES Product (businessId, id),
      CONSTRAINT fk_size_created_by FOREIGN KEY (businessId, createdBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT fk_size_updated_by FOREIGN KEY (businessId, updatedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_size_retail CHECK (retailMinor IS NULL OR retailMinor > 0),
      CONSTRAINT ck_size_wholesale CHECK (wholesaleMinor IS NULL OR wholesaleMinor > 0),
      CONSTRAINT ck_size_cost CHECK (costMinor IS NULL OR costMinor > 0),
      CONSTRAINT ck_size_version CHECK (version >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE PriceVersion (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      productId CHAR(36) NOT NULL,
      sizeId CHAR(36) NULL,
      sizeKey CHAR(36) AS (IFNULL(sizeId, '')) STORED NOT NULL,
      version INT UNSIGNED NOT NULL,
      retailMinor BIGINT NULL,
      wholesaleMinor BIGINT NULL,
      costMinor BIGINT NULL,
      createdByOpId CHAR(36) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_price_business_id (businessId, id),
      UNIQUE KEY uq_price_version (businessId, productId, sizeKey, version),
      CONSTRAINT fk_price_product FOREIGN KEY (businessId, productId) REFERENCES Product (businessId, id),
      CONSTRAINT fk_price_size FOREIGN KEY (businessId, sizeId) REFERENCES ProductSize (businessId, id),
      CONSTRAINT ck_price_product_retail CHECK (sizeId IS NOT NULL OR retailMinor IS NOT NULL),
      CONSTRAINT ck_price_retail CHECK (retailMinor IS NULL OR retailMinor > 0),
      CONSTRAINT ck_price_wholesale CHECK (wholesaleMinor IS NULL OR wholesaleMinor > 0),
      CONSTRAINT ck_price_cost CHECK (costMinor IS NULL OR costMinor > 0),
      CONSTRAINT ck_price_version CHECK (version >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Drops them again (development only; production goes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('DROP TABLE PriceVersion');
  await run('DROP TABLE ProductSize');
  await run('DROP TABLE Product');
  await run('ALTER TABLE ChangeLog DROP INDEX uq_changelog_seq, DROP COLUMN seq');
}

module.exports = { up, down };
