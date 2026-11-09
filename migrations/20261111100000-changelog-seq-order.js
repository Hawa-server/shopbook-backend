// Fixes the order of ChangeLog.seq for rows written BEFORE BE6.
//
// BE6 (20261110100000-products) added `seq` (AUTO_INCREMENT) so history can
// be shown in the order changes were saved. But when MySQL adds an
// AUTO_INCREMENT column to a table that already has rows, it numbers them in
// primary-key order, and ChangeLog's primary key is a random UUID: the old
// rows got their numbers in random order. That migration has already run on
// production, so it is never edited (CLAUDE.md); this new migration repairs
// the numbers instead.
//
// New order: by (changedAt, seq). For rows from before BE6, changedAt puts
// them in time order. For rows written since BE6, their seq is already right
// and stays the tie-breaker for two changes in the same millisecond. Rows
// keep their content; only seq changes. It runs in one transaction.

// Renumbers every ChangeLog row 1, 2, 3… in (changedAt, seq) order.
async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;
  await sequelize.transaction(async (transaction) => {
    const run = (sql) => sequelize.query(sql, { transaction });
    const [[{ maxSeq }]] = await run('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM ChangeLog');
    // 1. Move every number above the current highest, so step 2 never meets a
    //    number still in use (seq is UNIQUE).
    await run(`UPDATE ChangeLog SET seq = seq + ${Number(maxSeq)}`);
    // 2. The new numbers, worked out once into a temporary table.
    await run('CREATE TEMPORARY TABLE ChangeLogNewSeq (id CHAR(36) NOT NULL PRIMARY KEY, newSeq BIGINT UNSIGNED NOT NULL)');
    await run('INSERT INTO ChangeLogNewSeq (id, newSeq) SELECT id, ROW_NUMBER() OVER (ORDER BY changedAt, seq) FROM ChangeLog');
    await run('UPDATE ChangeLog c JOIN ChangeLogNewSeq n ON n.id = c.id SET c.seq = n.newSeq');
    await run('DROP TEMPORARY TABLE ChangeLogNewSeq');
  });
  // New rows keep counting up from AUTO_INCREMENT's counter (above every
  // number used so far); a gap in the numbers is harmless.
}

// Nothing to undo: the old order was random, so there is nothing to restore.
async function down() {}

module.exports = { up, down };
