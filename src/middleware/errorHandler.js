const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, _next) => {
  // Body-parser failures occur before the routers. Keep the ebook boundary in
  // effect for those errors too, without changing legacy API response contracts.
  if (/^\/api\/(?:admin\/|internal\/)?ebooks(?:\/|\?|$)/.test(req.originalUrl)) {
    return require('../controllers/ebookController').errorHandler(err, req, res, _next);
  }
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    message: err.message || 'Server Error',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};

module.exports = {
  notFound,
  errorHandler,
};
