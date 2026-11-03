// Gives every request its own ID (a UUID), sent back in the X-Request-Id
// header, written in every log line and shown in 500 errors ("Reference: …").
// When a trader reports a problem, that reference finds the exact request in
// the logs without anyone needing to see their records.

const { randomUUID } = require('node:crypto');

// Always makes a new ID; one sent by the client is ignored, so nobody can make
// their requests look like someone else's in the logs.
function requestId(req, res, next) {
  req.id = randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
