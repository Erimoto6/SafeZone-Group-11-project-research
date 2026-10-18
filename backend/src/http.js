// A small error type so routes can say "stop with this status and message".
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// Lets routes use async/await and hands any error to the error handler in app.js.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, wrap };
