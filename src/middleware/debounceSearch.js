const recentSearches = new Map();
const WINDOW_MS = 400;
const CLEANUP_MS = 60000;

const debounceSearch = (req, res, next) => {
  const key = req.ip || 'anonymous';
  const now = Date.now();

  const last = recentSearches.get(key);
  if (last && now - last < WINDOW_MS) {
    return res.status(429).json({ message: 'Too many search requests. Please slow down.' });
  }

  recentSearches.set(key, now);

  for (const [ip, timestamp] of recentSearches.entries()) {
    if (now - timestamp > CLEANUP_MS) {
      recentSearches.delete(ip);
    }
  }

  return next();
};

module.exports = debounceSearch;
