// BE5 Part A: phones (devices) and signed requests.
//
// - Device: one row per phone per business. Its `id` is made on the phone;
//   `deviceCode` (3 characters, e.g. K7M) starts its receipt numbers and is
//   unique in the business and NEVER reused, so a revoked phone's code stays
//   taken. `publicKey` is the phone's ECDSA P-256 public key (JWK); the
//   private key never leaves the phone. A revoked device is never reactivated.
//   Composite key (businessId, userId) → Membership: a phone always belongs
//   to a member of that business.
// - DeviceRequestNonce: the one-time numbers of signed requests, so a copied
//   request can't be replayed. Expired ones are deleted by the housekeeping
//   clean-up (src/services/housekeeping.js), the one allowed exception.
// - DeviceChallenge: the one-time challenge a phone signs to prove it holds
//   its key when registering. Only its SHA-256 is stored; valid 5 minutes,
//   used once; never deleted (a used or expired one simply can't be used).

// Creates the three tables.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    CREATE TABLE Device (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      userId CHAR(36) NOT NULL,
      deviceCode VARCHAR(4) NOT NULL,
      name VARCHAR(60) NOT NULL,
      publicKey JSON NOT NULL,
      keyAlgorithm VARCHAR(16) NOT NULL DEFAULT 'ECDSA-P256',
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      lastSeenAt DATETIME(3) NULL,
      lastSyncAt DATETIME(3) NULL,
      signatureLockedUntil DATETIME(3) NULL,
      revokedAt DATETIME(3) NULL,
      revokedBy CHAR(36) NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_device_business_id (businessId, id),
      UNIQUE KEY uq_device_business_code (businessId, deviceCode),
      KEY ix_device_user (businessId, userId),
      CONSTRAINT fk_device_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_device_member FOREIGN KEY (businessId, userId) REFERENCES Membership (businessId, userId),
      CONSTRAINT fk_device_revoked_by FOREIGN KEY (revokedBy) REFERENCES \`User\` (id),
      CONSTRAINT ck_device_code CHECK (deviceCode REGEXP '^[A-HJKMNP-Z2-46-79]{3,4}$'),
      CONSTRAINT ck_device_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 60),
      CONSTRAINT ck_device_algorithm CHECK (keyAlgorithm = 'ECDSA-P256'),
      CONSTRAINT ck_device_revoked CHECK ((isActive = 1) = (revokedAt IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE DeviceRequestNonce (
      businessId CHAR(36) NOT NULL,
      deviceId CHAR(36) NOT NULL,
      nonce VARCHAR(32) NOT NULL,
      expiresAt DATETIME(3) NOT NULL,
      PRIMARY KEY (businessId, deviceId, nonce),
      KEY ix_nonce_expiry (businessId, deviceId, expiresAt),
      CONSTRAINT fk_nonce_device FOREIGN KEY (businessId, deviceId) REFERENCES Device (businessId, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await run(`
    CREATE TABLE DeviceChallenge (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      userId CHAR(36) NOT NULL,
      challengeHash CHAR(64) NOT NULL,
      expiresAt DATETIME(3) NOT NULL,
      usedAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_challenge_hash (challengeHash),
      UNIQUE KEY uq_challenge_business_id (businessId, id),
      CONSTRAINT fk_challenge_member FOREIGN KEY (businessId, userId) REFERENCES Membership (businessId, userId),
      CONSTRAINT ck_challenge_hash CHECK (challengeHash REGEXP '^[0-9a-f]{64}$'),
      CONSTRAINT ck_challenge_expiry CHECK (expiresAt > createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Removes them (development and test databases only).
async function down(queryInterface) {
  for (const table of ['DeviceChallenge', 'DeviceRequestNonce', 'Device']) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

module.exports = { up, down };
