// BE6.5: product photos.
//
// - Photo: one row per uploaded photo. NOT a permanent record: replaced
//   photos are cleaned up by the approved rule (src/services/housekeeping.js).
//   The image itself is in object storage (Cloudflare R2 in production), never
//   in MySQL; storageKey says where. releasedAt is when a product last
//   stopped using it (the clean-up waits 30 days from then, or from
//   uploadedAt if no product ever used it).
// - Product.photoId: the product's current photo. Deliberately NO foreign
//   key: a phone may save the product before its photo has finished
//   uploading (offline), and a product must never be refused over a photo.

// Creates Photo and adds Product.photoId.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run(`
    CREATE TABLE Photo (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      contentType ENUM('image/jpeg', 'image/webp') NOT NULL,
      byteSize INT UNSIGNED NOT NULL,
      width SMALLINT UNSIGNED NOT NULL,
      height SMALLINT UNSIGNED NOT NULL,
      sha256 CHAR(64) NOT NULL,
      storageKey VARCHAR(160) NOT NULL,
      uploadedBy CHAR(36) NOT NULL,
      uploadedAt DATETIME(3) NOT NULL,
      releasedAt DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_photo_business_id (businessId, id),
      KEY ix_photo_business_uploaded (businessId, uploadedAt),
      CONSTRAINT fk_photo_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_photo_uploaded_by FOREIGN KEY (businessId, uploadedBy) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_photo_size CHECK (byteSize > 0 AND byteSize <= 307200 AND width BETWEEN 1 AND 1600 AND height BETWEEN 1 AND 1600)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  await run('ALTER TABLE Product ADD COLUMN photoId CHAR(36) NULL AFTER isHidden, ADD KEY ix_product_photo (businessId, photoId)');
}

// Removes them again (development only; production goes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('ALTER TABLE Product DROP KEY ix_product_photo, DROP COLUMN photoId');
  await run('DROP TABLE Photo');
}

module.exports = { up, down };
