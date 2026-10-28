const mongoose = require('mongoose');
const Centre = require('../models/Centre');
const CentreMembership = require('../models/CentreMembership');

// Call after protect. No platform-admin bypass: clinical capabilities are explicit.
function requireCentreCapability(capability) {
  return async (req, res, next) => {
    try {
      const centre = req.params.centreId;
      if (!req.user || !mongoose.isValidObjectId(centre)) {
        return res.status(403).json({ message: 'Centre access is required.' });
      }
      const now = new Date();
      const [activeCentre, membership] = await Promise.all([
        Centre.exists({ _id: centre, active: true }),
        CentreMembership.findOne({
          user: req.user._id, centre, active: true, capabilities: capability,
          startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
        }),
      ]);
      if (!activeCentre || !membership) return res.status(403).json({ message: 'Centre access is required.' });
      req.centreMembership = membership;
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { requireCentreCapability };
