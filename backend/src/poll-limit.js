// Classroom devices often share a public IP. Limit authenticated polling per account.
const rateLimit = require('express-rate-limit');
module.exports = process.env.RATE_LIMIT === 'off' ? (req, res, next) => next() : rateLimit({
  windowMs: 60e3, limit: 120,
  keyGenerator: req => String(req.user.id),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Updates were requested too often. Please wait a moment.' }
});
