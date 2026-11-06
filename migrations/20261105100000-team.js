// BE3: team invitations and the change history.
//
// Membership gains three columns for invitations (someone whose phone number
// already has an account is INVITED and must accept), and its state rule is
// replaced so exactly three states are possible:
//   active   isActive = 1, removedAt NULL
//   invited  isActive = 0, removedAt NULL, invitedAt set
//   ended    isActive = 0, removedAt set (removed by the owner, or declined:
//            declinedAt is then set too)
// An owner is never an invitation. The one-active-owner key is unchanged.
//
// ChangeLog: one row per change to the team (and, from BE5, to every editable
// record), with who, when, and the values before and after. Insert only.

// Adds the columns, swaps the CHECK and creates ChangeLog.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);

  await run(`
    ALTER TABLE Membership
      ADD COLUMN invitedName VARCHAR(60) NULL AFTER role,
      ADD COLUMN invitedAt DATETIME(3) NULL AFTER invitedName,
      ADD COLUMN declinedAt DATETIME(3) NULL AFTER removedAt,
      DROP CHECK ck_membership_removed,
      ADD CONSTRAINT ck_membership_state CHECK (
        (isActive = 1 AND removedAt IS NULL)
        OR (isActive = 0 AND (removedAt IS NOT NULL OR invitedAt IS NOT NULL))
      ),
      ADD CONSTRAINT ck_membership_declined CHECK (declinedAt IS NULL OR removedAt IS NOT NULL),
      ADD CONSTRAINT ck_membership_owner_not_invited CHECK (role <> 'owner' OR invitedAt IS NULL),
      ADD CONSTRAINT ck_membership_invited_name CHECK (invitedName IS NULL OR CHAR_LENGTH(TRIM(invitedName)) BETWEEN 1 AND 60)
  `);

  await run(`
    CREATE TABLE ChangeLog (
      id CHAR(36) NOT NULL,
      businessId CHAR(36) NOT NULL,
      entity VARCHAR(40) NOT NULL,
      entityId CHAR(36) NOT NULL,
      changedBy CHAR(36) NOT NULL,
      changedAt DATETIME(3) NOT NULL,
      \`before\` JSON NULL,
      \`after\` JSON NULL,
      conflict TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY uq_changelog_business_id (businessId, id),
      KEY ix_changelog_entity (businessId, entity, entityId),
      CONSTRAINT fk_changelog_business FOREIGN KEY (businessId) REFERENCES Business (id),
      CONSTRAINT fk_changelog_changed_by FOREIGN KEY (changedBy) REFERENCES \`User\` (id),
      CONSTRAINT ck_changelog_entity CHECK (CHAR_LENGTH(entity) BETWEEN 1 AND 40)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Undoes it (development and test databases only; production fixes forward).
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('DROP TABLE IF EXISTS ChangeLog');
  await run(`
    ALTER TABLE Membership
      DROP CHECK ck_membership_state,
      DROP CHECK ck_membership_declined,
      DROP CHECK ck_membership_owner_not_invited,
      DROP CHECK ck_membership_invited_name,
      DROP COLUMN invitedName,
      DROP COLUMN invitedAt,
      DROP COLUMN declinedAt,
      ADD CONSTRAINT ck_membership_removed CHECK ((isActive = 1) = (removedAt IS NULL))
  `);
}

module.exports = { up, down };
