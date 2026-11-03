// The one error type the server throws on purpose. Every error the app sees
// has the same shape, { "error": { "code", "message", "fields"? } }, so the
// phone can decide what to do from `code` alone (the list is in docs/api.md).

// An expected failure with an HTTP status, a stable code, a plain message the
// app can show, and optionally per-field messages for forms.
class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }

  // The JSON body sent to the client. Nothing else from the error leaves the server.
  toBody() {
    const error = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

module.exports = { AppError };
