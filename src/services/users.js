// Changes to a person's account row (User is not business data: one person
// can belong to several businesses). Kept here so route handlers never write
// SQL themselves (a test checks that).

// Updates one user inside `transaction`. With `endOtherSignIns`, it also adds
// 1 to sessionVersion IN SQL ("sessionVersion + 1"), so two changes at the
// same moment can't both write the same number. Every sign-in holding the old
// number stops working at once (password, phone or email changes; resets).
function updateUser(models, transaction, userId, changes, { endOtherSignIns = false } = {}) {
  const values = { ...changes };
  if (endOtherSignIns) values.sessionVersion = models.User.sequelize.literal('sessionVersion + 1');
  return models.User.update(values, { where: { id: userId }, transaction });
}

module.exports = { updateUser };
