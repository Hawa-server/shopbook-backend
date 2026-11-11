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
    phone: { type: DataTypes.STRING(16), allowNull: false }, // E.164, e.g. +233241234567
    email: { type: DataTypes.STRING(254), allowNull: true },
    emailConfirmedAt: time(),
    pendingEmail: { type: DataTypes.STRING(254), allowNull: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    language: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'en' }, // a tag from src/locale
    sessionVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    termsVersion: { type: DataTypes.STRING(20), allowNull: true },
    termsAcceptedAt: time(),
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Business = sequelize.define('Business', {
    id,
    // Locale facts (BE4.5): set at sign-up from the country, locked once the
    // first money record exists (moneyRecordedAt, set from BE7/BE8).
    country: { type: DataTypes.CHAR(2), allowNull: false },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    timezone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'Africa/Accra' },
    moneyRecordedAt: time(),
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
    paymentMethods: { type: DataTypes.JSON, allowNull: false }, // codes from src/locale, e.g. ["cash","mobile_money"]
    defaultLanguage: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'en' },
    lowStockThreshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    returnPeriodDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    defaultCreditLimitMinor: { type: DataTypes.BIGINT, allowNull: true }, // whole minor units of the business's currency
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, // the business's sync sequence number (BE5)
    updatedBy: ref(true), // NULL = a system change (no person); otherwise a member of this business
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Location = sequelize.define('Location', {
    id,
    businessId: ref(),
    name: { type: DataTypes.STRING(60), allowNull: false },
    type: { type: DataTypes.ENUM('shop', 'warehouse'), allowNull: false, defaultValue: 'shop' },
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, // the business's sync sequence number (BE5)
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  const Membership = sequelize.define('Membership', {
    id,
    businessId: ref(),
    userId: ref(),
    role: { type: DataTypes.ENUM('owner', 'manager', 'associate'), allowNull: false },
    // For an invitation: the name the owner typed (shown to the owner instead
    // of the account's own name) and when it was sent.
    invitedName: { type: DataTypes.STRING(60), allowNull: true },
    invitedAt: time(),
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: ref(),
    removedAt: time(),
    declinedAt: time(),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, // the business's sync sequence number (BE5)
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

  // One row per change (who, when, before, after). Insert only: there is no
  // code that updates or deletes ChangeLog rows. No createdAt/updatedAt:
  // changedAt is the time.
  const ChangeLog = sequelize.define('ChangeLog', {
    id,
    businessId: ref(),
    entity: { type: DataTypes.STRING(40), allowNull: false },
    entityId: ref(),
    changedBy: ref(true), // NULL = a system change (no person); otherwise a member of this business
    changedAt: time(false),
    before: { type: DataTypes.JSON, allowNull: true },
    after: { type: DataTypes.JSON, allowNull: true },
    conflict: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { freezeTableName: true, timestamps: false });

  // A phone registered to one member in one business (BE5). The id comes
  // from the phone; deviceCode is never reused; a revoked phone stays revoked.
  const Device = sequelize.define('Device', {
    id,
    businessId: ref(),
    userId: ref(),
    deviceCode: { type: DataTypes.STRING(4), allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
    publicKey: { type: DataTypes.JSON, allowNull: false }, // ECDSA P-256 public key (JWK)
    keyAlgorithm: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'ECDSA-P256' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastSeenAt: time(),
    lastSyncAt: time(),
    signatureLockedUntil: time(), // set after too many failed signatures
    revokedAt: time(),
    revokedBy: ref(true),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, // the business's sync sequence number (BE5)
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  // One-time numbers of signed requests (replay protection). No id column.
  const DeviceRequestNonce = sequelize.define('DeviceRequestNonce', {
    businessId: { type: DataTypes.CHAR(36), primaryKey: true },
    deviceId: { type: DataTypes.CHAR(36), primaryKey: true },
    nonce: { type: DataTypes.STRING(32), primaryKey: true },
    expiresAt: time(false),
  }, { freezeTableName: true, timestamps: false });

  // One-time challenges signed by a phone to prove it holds its key.
  const DeviceChallenge = sequelize.define('DeviceChallenge', {
    id,
    businessId: ref(),
    userId: ref(),
    challengeHash: { type: DataTypes.CHAR(64), allowNull: false },
    expiresAt: time(false),
    usedAt: time(),
    createdAt: time(false),
  }, { freezeTableName: true, timestamps: true, updatedAt: false });

  // Sync bookkeeping (BE5 Part B). SyncSequence is touched ONLY by
  // src/sync/runOperation.js (a test checks it).
  const SyncSequence = sequelize.define('SyncSequence', {
    businessId: { type: DataTypes.CHAR(36), primaryKey: true },
    lastSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
  }, { freezeTableName: true, timestamps: false });

  // The outcome of every pushed operation, stored with its effect.
  const ProcessedOperation = sequelize.define('ProcessedOperation', {
    businessId: { type: DataTypes.CHAR(36), primaryKey: true },
    opId: { type: DataTypes.CHAR(36), primaryKey: true },
    deviceId: ref(),
    userId: ref(),
    type: { type: DataTypes.STRING(40), allowNull: false },
    payloadHash: { type: DataTypes.CHAR(64), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'saved', 'rejected'), allowNull: false },
    errorCode: { type: DataTypes.STRING(40), allowNull: true },
    resultJson: { type: DataTypes.JSON, allowNull: true },
    processedAt: time(false),
  }, { freezeTableName: true, timestamps: false });

  // The receipt registry (used from BE8).
  const ReceiptNumber = sequelize.define('ReceiptNumber', {
    businessId: { type: DataTypes.CHAR(36), primaryKey: true },
    receiptNumber: { type: DataTypes.STRING(20), primaryKey: true },
    recordType: { type: DataTypes.ENUM('sale', 'correction', 'repayment'), allowNull: false },
    recordId: ref(),
    deviceId: ref(),
    createdAt: time(false),
  }, { freezeTableName: true, timestamps: true, updatedAt: false });

  // Products and sizes (BE6). Editable records: version, updatedBy and
  // updatedAt, "last change received wins, with history" (ChangeLog).
  // nameNormalized is indexed but NOT unique (same-name products are kept and
  // warned about). costMinor is the owner's only: the pull leaves it out for
  // everyone else.
  const money = (allowNull = true) => ({ type: DataTypes.BIGINT, allowNull }); // whole minor units
  const Product = sequelize.define('Product', {
    id,
    businessId: ref(),
    name: { type: DataTypes.STRING(80), allowNull: false },
    nameNormalized: { type: DataTypes.STRING(80), allowNull: false },
    type: { type: DataTypes.ENUM('clothing', 'shoes', 'fabric', 'other'), allowNull: false },
    unit: { type: DataTypes.ENUM('piece', 'pair', 'set', 'dozen', 'yard', 'custom'), allowNull: false },
    unitLabel: { type: DataTypes.STRING(20), allowNull: true }, // the shop's own word, for unit 'custom'
    unitScale: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false }, // 2 for yards (half yards), else 1; set by the server
    retailMinor: money(false),
    wholesaleMinor: money(),
    costMinor: money(),
    lowStockLevelUnits: { type: DataTypes.INTEGER, allowNull: true }, // BE7: this product's own low-stock level (null = the business's)
    lowStockWarnings: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // BE7: false = no low-stock warnings for it
    isHidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    createdBy: ref(),
    updatedBy: ref(true),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  // A product's size. NULL prices mean "use the product's".
  const ProductSize = sequelize.define('ProductSize', {
    id,
    businessId: ref(),
    productId: ref(),
    label: { type: DataTypes.STRING(20), allowNull: false },
    labelNormalized: { type: DataTypes.STRING(20), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false },
    retailMinor: money(),
    wholesaleMinor: money(),
    costMinor: money(),
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    createdBy: ref(),
    updatedBy: ref(true),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  // Server-only price history (insert only, never pulled): the prices and
  // cost of a product (sizeId NULL) or size at each version. sizeKey is a
  // generated column (MySQL works it out) and is left out here.
  const PriceVersion = sequelize.define('PriceVersion', {
    id,
    businessId: ref(),
    productId: ref(),
    sizeId: ref(true),
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    retailMinor: money(),
    wholesaleMinor: money(),
    costMinor: money(),
    createdByOpId: ref(),
    createdAt: time(false),
  }, { freezeTableName: true, timestamps: true, updatedAt: false });

  // Stock (BE7). Both are PERMANENT records: inserted, never changed. Stock
  // on hand is never stored: see src/services/stockRule.js.
  const StockMovement = sequelize.define('StockMovement', {
    id,
    businessId: ref(),
    locationId: ref(),
    productId: ref(),
    sizeId: ref(true),
    quantityUnits: { type: DataTypes.INTEGER, allowNull: false }, // signed: + in, − out (half yards for yard products)
    type: { type: DataTypes.ENUM('opening', 'restock', 'sale', 'return_in', 'exchange_in', 'exchange_out', 'removal'), allowNull: false },
    reason: { type: DataTypes.ENUM('damaged', 'lost', 'supplier_return', 'used', 'other'), allowNull: true },
    note: { type: DataTypes.STRING(200), allowNull: true },
    saleId: ref(true),
    correctionId: ref(true),
    flags: { type: DataTypes.JSON, allowNull: false }, // set once on save: { belowZeroOnArrival?, clockSkew? }
    recordedBy: ref(),
    recordedAt: time(false), // the phone's time
    receivedAt: time(false), // the server's time
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  // What was on the shelf when someone counted (never a difference).
  const StockCount = sequelize.define('StockCount', {
    id,
    businessId: ref(),
    locationId: ref(),
    productId: ref(),
    sizeId: ref(true),
    countedUnits: { type: DataTypes.INTEGER, allowNull: false },
    baselineUnits: { type: DataTypes.INTEGER, allowNull: false }, // what the phone showed
    baselineCursor: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, // the phone's sync cursor then
    reason: { type: DataTypes.ENUM('damaged', 'lost_or_stolen', 'miscounted_before', 'other'), allowNull: true },
    note: { type: DataTypes.STRING(200), allowNull: true },
    recordedBy: ref(),
    recordedAt: time(false),
    receivedAt: time(false),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  // A customer (BE8 creates them; BE9 edits them and sets credit limits).
  // balanceMinor and oldestUnpaidAt are a server-made cache, never sent by phones.
  const Customer = sequelize.define('Customer', {
    id,
    businessId: ref(),
    name: { type: DataTypes.STRING(80), allowNull: false }, // up to 80 since BE9 (Epic 4 AC1)
    nameNormalized: { type: DataTypes.STRING(80), allowNull: false },
    phone: { type: DataTypes.STRING(16), allowNull: true }, // E.164; never logged
    language: { type: DataTypes.STRING(16), allowNull: false },
    isHidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    creditLimitMinor: money(),
    balanceMinor: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    oldestUnpaidAt: time(),
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    createdBy: ref(),
    updatedBy: ref(true),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    createdAt: time(false),
    updatedAt: time(false),
  }, common);

  // Sales (BE8): PERMANENT records. A sale's lines and payments are pulled
  // inside the sale's own row (they have no serverSeq of their own).
  const Sale = sequelize.define('Sale', {
    id,
    businessId: ref(),
    locationId: ref(),
    deviceId: ref(),
    receiptNumber: { type: DataTypes.STRING(20), allowNull: false },
    customerId: ref(true),
    priceType: { type: DataTypes.ENUM('retail', 'wholesale'), allowNull: false },
    subtotalMinor: money(false),
    paidMinor: money(false),
    creditMinor: money(false),
    flags: { type: DataTypes.JSON, allowNull: false }, // set once on save; some are owner/manager only (src/sync/pull.js)
    recordedBy: ref(),
    recordedAt: time(false),
    receivedAt: time(false),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  const SaleItem = sequelize.define('SaleItem', {
    id,
    businessId: ref(),
    saleId: ref(),
    productId: ref(),
    sizeId: ref(true),
    productName: { type: DataTypes.STRING(80), allowNull: false }, // copies at the time of the sale
    sizeLabel: { type: DataTypes.STRING(20), allowNull: true },
    unit: { type: DataTypes.ENUM('piece', 'pair', 'set', 'dozen', 'yard', 'custom'), allowNull: false },
    unitLabel: { type: DataTypes.STRING(20), allowNull: true },
    unitScale: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    quantityUnits: { type: DataTypes.INTEGER, allowNull: false },
    productVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    sizeVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    setPriceMinor: money(false),
    agreedPriceMinor: money(false),
    lineTotalMinor: money(false),
    priceNote: { type: DataTypes.STRING(200), allowNull: true },
    unitCostMinor: money(), // OWNER ONLY, set by the server from the version's cost
  }, { freezeTableName: true, timestamps: false });

  const SalePayment = sequelize.define('SalePayment', {
    id,
    businessId: ref(),
    saleId: ref(),
    method: { type: DataTypes.STRING(30), allowNull: false },
    amountMinor: money(false),
  }, { freezeTableName: true, timestamps: false });

  // Debts (BE9). Repayments, write-offs and debts brought forward are
  // PERMANENT records; a mistake is fixed by a REVERSAL (a record of the same
  // kind pointing at the original with corrects…Id), never by an edit.
  const reversalOf = (column) => ({ [column]: ref(true), correctionReason: { type: DataTypes.STRING(200), allowNull: true } });
  const Repayment = sequelize.define('Repayment', {
    id,
    businessId: ref(),
    customerId: ref(),
    deviceId: ref(),
    receiptNumber: { type: DataTypes.STRING(20), allowNull: false },
    amountMinor: money(false),
    method: { type: DataTypes.STRING(30), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    ...reversalOf('correctsRepaymentId'),
    flags: { type: DataTypes.JSON, allowNull: false }, // set once: overpaid, methodDisabled, clockSkew
    recordedBy: ref(),
    recordedAt: time(false),
    receivedAt: time(false),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  const DebtWriteOff = sequelize.define('DebtWriteOff', {
    id,
    businessId: ref(),
    customerId: ref(),
    amountMinor: money(false),
    reason: { type: DataTypes.ENUM('moved', 'died', 'disputed', 'other'), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    ...reversalOf('correctsDebtWriteOffId'),
    recordedBy: ref(),
    recordedAt: time(false),
    receivedAt: time(false),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  const OpeningDebt = sequelize.define('OpeningDebt', {
    id,
    businessId: ref(),
    customerId: ref(),
    deviceId: ref(),
    amountMinor: money(false),
    owedSince: { type: DataTypes.DATEONLY, allowNull: false }, // a business date (the business's time zone)
    note: { type: DataTypes.STRING(200), allowNull: true },
    ...reversalOf('correctsOpeningDebtId'),
    recordedBy: ref(),
    recordedAt: time(false),
    receivedAt: time(false),
    serverSeq: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  }, { freezeTableName: true, timestamps: false });

  // Worked-out debt tables (projections, never sent to phones): rebuilt from
  // the permanent records by src/services/debtLots.js, the ONLY code allowed
  // to delete their rows (one customer at a time, in an operation's transaction).
  const DebtLot = sequelize.define('DebtLot', {
    id,
    businessId: ref(),
    customerId: ref(),
    sourceType: { type: DataTypes.ENUM('opening_debt', 'credit_sale', 'exchange_credit'), allowNull: false },
    sourceId: ref(),
    originalMinor: money(false),
    outstandingMinor: money(false),
    effectiveAt: time(false),
    orderKey: { type: DataTypes.STRING(120), allowNull: false },
  }, { freezeTableName: true, timestamps: false });

  const CreditLot = sequelize.define('CreditLot', {
    id,
    businessId: ref(),
    customerId: ref(),
    sourceType: { type: DataTypes.ENUM('repayment_excess', 'write_off_excess', 'return_kept_as_credit', 'return_excess'), allowNull: false },
    sourceId: ref(),
    originalMinor: money(false),
    remainingMinor: money(false),
    effectiveAt: time(false),
    orderKey: { type: DataTypes.STRING(120), allowNull: false },
  }, { freezeTableName: true, timestamps: false });

  const DebtAllocation = sequelize.define('DebtAllocation', {
    id,
    businessId: ref(),
    customerId: ref(),
    debtLotId: ref(),
    sourceType: { type: DataTypes.ENUM('repayment', 'write_off', 'return_debt', 'credit_lot'), allowNull: false },
    sourceId: ref(),
    amountMinor: money(false),
    orderKey: { type: DataTypes.STRING(120), allowNull: false },
  }, { freezeTableName: true, timestamps: false });

  // Associations used to read a person's businesses with their names, and a
  // business's members with their accounts.
  Membership.belongsTo(Business, { foreignKey: 'businessId', as: 'business' });
  Business.hasOne(BusinessSettings, { foreignKey: 'businessId', as: 'settings' });
  Membership.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Device.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'items' });
  Sale.hasMany(SalePayment, { foreignKey: 'saleId', as: 'payments' });

  return {
    User, Business, BusinessSettings, Location, Membership, EmailToken, ChangeLog,
    Device, DeviceRequestNonce, DeviceChallenge, SyncSequence, ProcessedOperation, ReceiptNumber,
    Product, ProductSize, PriceVersion, StockMovement, StockCount, Customer, Sale, SaleItem, SalePayment,
    Repayment, DebtWriteOff, OpeningDebt, DebtLot, CreditLot, DebtAllocation,
  };
}

// The models holding ONE business's data (they have a businessId column).
// Route handlers reach them only through scoped() (src/services/scoped.js);
// a test fails the build otherwise. Every later business table joins this list.
const BUSINESS_MODELS = ['BusinessSettings', 'Location', 'Membership', 'ChangeLog', 'Device', 'DeviceRequestNonce', 'DeviceChallenge', 'ProcessedOperation', 'ReceiptNumber', 'Product', 'ProductSize', 'PriceVersion', 'StockMovement', 'StockCount', 'Customer', 'Sale', 'SaleItem', 'SalePayment',
  'Repayment', 'DebtWriteOff', 'OpeningDebt', 'DebtLot', 'CreditLot', 'DebtAllocation'];

// The tables phones pull (each row has a serverSeq), and the pull row type of each.
const SYNCED_MODELS = {
  BusinessSettings: 'settings', Location: 'location', Membership: 'membership', Device: 'device', Product: 'product', ProductSize: 'size',
  StockMovement: 'stockMovement', StockCount: 'stockCount', Customer: 'customer', Sale: 'sale',
  Repayment: 'repayment', DebtWriteOff: 'debtWriteOff', OpeningDebt: 'openingDebt',
};

// Permanent records (sales, repayments, stock movements…): never updated or
// deleted; scoped().update refuses every model listed here. PriceVersion
// (BE6), stock movements and counts (BE7), sales with their lines and
// payments (BE8).
const PERMANENT_MODELS = ['PriceVersion', 'StockMovement', 'StockCount', 'Sale', 'SaleItem', 'SalePayment', 'Repayment', 'DebtWriteOff', 'OpeningDebt'];

// The worked-out debt tables (BE9): the ONLY business tables whose rows may
// be deleted outside deleteBusinessData, and only by src/services/debtLots.js
// when it rebuilds one customer (approved by the owner, 11 Nov 2026). A test
// fails if a permanent table is ever added here.
const PROJECTION_MODELS = ['DebtAllocation', 'CreditLot', 'DebtLot'];

module.exports = { defineModels, BUSINESS_MODELS, PERMANENT_MODELS, PROJECTION_MODELS, SYNCED_MODELS };
