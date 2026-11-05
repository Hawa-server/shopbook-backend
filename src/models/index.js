// Sequelize models for the tables the migrations create. Models only describe
// tables for the code; the migrations are what actually create them (never
// sync()), so the database's own rules (CHECKs, keys) live in migrations/.
// Columns MySQL works out itself (Membership.activeOwnerBusinessId) are left
// out, so the code can never try to write them.

const { DataTypes } = require('sequelize');

// Options shared by every model: the table name is exactly the model name,
// and createdAt/updatedAt are kept with millisecond precision.
const common = { freezeTableName: true, timestamps: true };

// Defines every model on `sequelize` and returns them by name.
function defineModels(sequelize) {
  const id = { type: DataTypes.CHAR(36), primaryKey: true };
  const ref = (allowNull = false) => ({ type: DataTypes.CHAR(36), allowNull });
  const time = (allowNull = true) => ({ type: DataTypes.DATE(3), allowNull });

  const User = sequelize.define('User', {
    id,
    name: { type: DataTypes.STRING(60), allowNull: false },
    phone: { type: DataTypes.STRING(13), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: true },
    emailConfirmedAt: time(),
    pendingEmail: { type: DataTypes.STRING(254), allowNull: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    language: { type: DataTypes.ENUM('en', 'tw'), allowNull: false, defaultValue: 'en' },
    sessionVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    termsVersion: { type: DataTypes.STRING(20), allowNull: true },
    termsAcceptedAt: time(),
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Business = sequelize.define('Business', {
    id,
    timezone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'Africa/Accra' },
    status: { type: DataTypes.ENUM('active', 'closing'), allowNull: false, defaultValue: 'active' },
    isPractice: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    practiceForBusinessId: ref(true),
    closeRequestedAt: time(),
    closeRequestedBy: ref(true),
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const BusinessSettings = sequelize.define('BusinessSettings', {
    businessId: { type: DataTypes.CHAR(36), primaryKey: true },
    businessName: { type: DataTypes.STRING(60), allowNull: false },
    receiptPhone: { type: DataTypes.STRING(20), allowNull: true },
    receiptNote: { type: DataTypes.STRING(120), allowNull: true },
    defaultLanguage: { type: DataTypes.ENUM('en', 'tw'), allowNull: false, defaultValue: 'en' },
    lowStockThreshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    returnPeriodDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    defaultCreditLimitPesewas: { type: DataTypes.BIGINT, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    updatedBy: ref(),
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Location = sequelize.define('Location', {
    id,
    businessId: ref(),
    name: { type: DataTypes.STRING(60), allowNull: false },
    type: { type: DataTypes.ENUM('shop', 'warehouse'), allowNull: false, defaultValue: 'shop' },
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Membership = sequelize.define('Membership', {
    id,
    businessId: ref(),
    userId: ref(),
    role: { type: DataTypes.ENUM('owner', 'manager', 'associate'), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: ref(),
    removedAt: time(),
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  // Email tokens have no updatedAt: they're created, then only marked used.
  const EmailToken = sequelize.define('EmailToken', {
    id,
    userId: ref(),
    purpose: { type: DataTypes.ENUM('confirm_email', 'reset_password', 'change_email'), allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false },
    expiresAt: time(false),
    usedAt: time(),
    createdAt: time(false),
  }, { freezeTableName: true, timestamps: true, updatedAt: false });

  // Associations used to read a person's businesses with their names.
  Membership.belongsTo(Business, { foreignKey: 'businessId', as: 'business' });
  Business.hasOne(BusinessSettings, { foreignKey: 'businessId', as: 'settings' });

  return { User, Business, BusinessSettings, Location, Membership, EmailToken };
}

module.exports = { defineModels };
