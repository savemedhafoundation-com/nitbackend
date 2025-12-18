const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

const normalizeOrigin = origin => (typeof origin === 'string' ? origin.replace(/\/$/, '') : origin);

const defaultOrigins = ['http://localhost:5173', 'http://localhost:4173', 'https://nit.care', 'https://www.nit.care'];

const allowedOrigins = [
  ...defaultOrigins,
  ...(process.env.CLIENT_URL || '')
    .split(',')
    .map(origin => normalizeOrigin(origin.trim()))
    .filter(Boolean),
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.includes(normalized)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', routes);

const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
const hasClientBuild = fs.existsSync(path.join(clientDistPath, 'index.html'));

if (process.env.NODE_ENV === 'production' && hasClientBuild) {
  app.use(express.static(clientDistPath));

  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      return next();
    }

    return res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).json({
      message: 'Natural Immunotherapy API is running',
      docs: '/api/health',
    });
  });
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
module.exports.handler = app;
