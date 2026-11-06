// Payment methods (BE4.5). Each business uses the methods in its settings
// (`paymentMethods`, from its country: in Ghana cash and mobile money, shown
// "MoMo"). A payment in any other method is refused. This doesn't touch the
// sale invariants: paid is still the sum of the payments, whatever the method.
// Used by sales and repayments from BE8/BE9.

const { AppError } = require('../lib/errors');
const { PAYMENT_METHODS } = require('../locale');

// Throws PAYMENT_METHOD_NOT_ENABLED unless `method` is a known method AND one
// of this business's `paymentMethods`.
function assertPaymentMethodEnabled(paymentMethods, method) {
  if (!Object.hasOwn(PAYMENT_METHODS, method) || !paymentMethods.includes(method)) {
    throw new AppError(400, 'PAYMENT_METHOD_NOT_ENABLED', "This business doesn't take that payment method.");
  }
}

module.exports = { assertPaymentMethodEnabled };
