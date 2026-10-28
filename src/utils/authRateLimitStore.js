const { createHash } = require('node:crypto');
const AuthAttempt = require('../models/AuthAttempt');

// Shared across serverless instances; fixed-window keys do not depend on TTL cleanup timing.
class AuthRateLimitStore {
  localKeys = false;
  init(options) { this.windowMs = options.windowMs; }
  bucket(key) {
    const window = Math.floor(Date.now() / this.windowMs);
    const hash = createHash('sha256').update(key).digest('hex');
    return { id: `${window}:${hash}`, expiresAt: new Date((window + 1) * this.windowMs) };
  }
  async increment(key) {
    const { id, expiresAt } = this.bucket(key);
    const row = await AuthAttempt.findOneAndUpdate({ _id: id }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt },
    }, { upsert: true, new: true });
    return { totalHits: row.count, resetTime: row.expiresAt };
  }
  async decrement(key) { await AuthAttempt.updateOne({ _id: this.bucket(key).id, count: { $gt: 0 } }, { $inc: { count: -1 } }); }
  async resetKey(key) { await AuthAttempt.deleteOne({ _id: this.bucket(key).id }); }
}
module.exports = AuthRateLimitStore;
