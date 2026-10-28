const { randomUUID } = require('node:crypto');
const AuditEvent = require('../models/AuditEvent');

// Persist intent before invoking a mutation. This event is not a success receipt.
// No body, tokens, filenames or patient content are copied to the audit log.
function auditMutation(action) {
  return async (req, res, next) => {
    try {
      const requestId = randomUUID();
      await AuditEvent.create({ actor: req.user._id, action, target: req.params.id || req.params.planId || req.params.patientId || String(req.user._id), centre: req.params.centreId, requestId });
      res.set('X-Request-ID', requestId);
      return next();
    } catch (error) { return next(error); }
  };
}
module.exports = { auditMutation };
