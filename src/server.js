const http = require('http');
const dotenv = require('dotenv');

// Load environment variables before importing any modules that depend on them
dotenv.config();

const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

process.on('unhandledRejection', err => {
  console.error('Unhandled promise rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('Gracefully shutting down');
  process.exit(0);
});
