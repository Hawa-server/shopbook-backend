// The last two steps of every request: "not found" for unknown routes, and
// the error handler that turns anything thrown into the one error format,
// { "error": { "code", "message", "fields"? } }. No stack trace, SQL or secret
// ever reaches the client; unexpected errors get a reference (the request ID)
// that points to the full details in the server's logs.

const { AppError } = require('../lib/errors');
const { describeError } = require('../lib/logger');

// Reached only when no route matched. Answered like any other "not found",
// which is also how another business's records are answered (from BE3).
function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Not found'));
}

// Maps the body reader's own errors (bad JSON, too large) to our codes.
function fromBodyParserError(err) {
  if (err.type === 'entity.parse.failed') {
    return new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (err.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  }
  if (typeof err.type === 'string' && err.status >= 400 && err.status < 500) {
    return new AppError(400, 'INVALID_REQUEST', "The request couldn't be read.");
  }
  return null;
}

// Express error handler (it has four arguments, which is how Express knows).
// Expected errors (AppError) are answered as they are; anything else is a bug
// or an outage: logged in full on the server, answered with a plain 500.
function errorHandler({ logger }) {
  return function handleError(err, req, res, next) {
    if (res.headersSent) return next(err);

    const known = err instanceof AppError ? err : fromBodyParserError(err);
    if (known) {
      if (known.status >= 500) logger.error('request_failed', { requestId: req.id, code: known.code });
      return res.status(known.status).json(known.toBody());
    }

    logger.error('unexpected_error', { requestId: req.id, path: req.originalUrl.split('?')[0], ...describeError(err) });
    const internal = new AppError(500, 'INTERNAL_ERROR', `Something went wrong. Reference: ${req.id}`);
    return res.status(500).json(internal.toBody());
  };
}

module.exports = { notFound, errorHandler };
