// Customer names up to 80 characters (BE9; Epic 4 AC1 says 80). BE8 made the
// columns 60 long; that migration has run on production, so it's never
// edited: this one widens them. Widening never changes or cuts existing names.

// Widens the name columns to 80.
async function up(queryInterface) {
  await queryInterface.sequelize.query('ALTER TABLE Customer MODIFY name VARCHAR(80) NOT NULL, MODIFY nameNormalized VARCHAR(80) NOT NULL');
}

// Back to 60 (development only; refuses if a longer name exists, rather than cutting it).
async function down(queryInterface) {
  const [[{ n }]] = await queryInterface.sequelize.query('SELECT COUNT(*) AS n FROM Customer WHERE CHAR_LENGTH(name) > 60');
  if (Number(n) > 0) throw new Error('A customer name is longer than 60 characters; not shortening.');
  await queryInterface.sequelize.query('ALTER TABLE Customer MODIFY name VARCHAR(60) NOT NULL, MODIFY nameNormalized VARCHAR(60) NOT NULL');
}

module.exports = { up, down };
