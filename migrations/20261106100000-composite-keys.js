// BE4: the first composite foreign keys between business tables.
//
// A composite foreign key points at a PAIR of columns: (businessId, someId).
// Because the pair must exist in the other table, a row in business A can
// never point at a record of business B, even if the code has a bug.
//
// - ChangeLog (businessId, changedBy) → Membership (businessId, userId):
//   a change in business A can only be recorded as made by someone with a
//   membership row in A (active, invited or ended: rows are never deleted,
//   so old history stays valid after someone leaves).
// - BusinessSettings (businessId, updatedBy) → Membership (businessId, userId):
//   settings can only be marked as edited by a member of that business.
//
// changedBy and updatedBy become NULLable: NULL means a SYSTEM change (a
// later scheduled job, BE13/BE15) made by nobody in particular. MySQL skips a
// foreign key check when any of its columns is NULL, so NULL is accepted.

// Makes the two columns nullable, then adds the composite keys.
async function up(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('ALTER TABLE ChangeLog MODIFY changedBy CHAR(36) NULL');
  await run('ALTER TABLE BusinessSettings MODIFY updatedBy CHAR(36) NULL');
  await run(`
    ALTER TABLE ChangeLog
      ADD CONSTRAINT fk_changelog_member FOREIGN KEY (businessId, changedBy)
        REFERENCES Membership (businessId, userId)
  `);
  await run(`
    ALTER TABLE BusinessSettings
      ADD CONSTRAINT fk_settings_member FOREIGN KEY (businessId, updatedBy)
        REFERENCES Membership (businessId, userId)
  `);
}

// Removes the keys and makes the columns required again (development and
// test databases only). It fails if a NULL system change exists, on purpose.
async function down(queryInterface) {
  const run = (sql) => queryInterface.sequelize.query(sql);
  await run('ALTER TABLE ChangeLog DROP FOREIGN KEY fk_changelog_member');
  await run('ALTER TABLE BusinessSettings DROP FOREIGN KEY fk_settings_member');
  await run('ALTER TABLE ChangeLog DROP INDEX fk_changelog_member');
  await run('ALTER TABLE BusinessSettings DROP INDEX fk_settings_member');
  await run('ALTER TABLE ChangeLog MODIFY changedBy CHAR(36) NOT NULL');
  await run('ALTER TABLE BusinessSettings MODIFY updatedBy CHAR(36) NOT NULL');
}

module.exports = { up, down };
