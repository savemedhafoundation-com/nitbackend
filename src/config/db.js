const mongoose = require("mongoose");

// ✅ Maintain a global cached connection across serverless invocations
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoURI) {
    throw new Error("❌ MONGO_URI (or MONGODB_URI) environment variable is not defined");
  }

  // ✅ Return existing connection if available
  if (cached.conn) {
    return cached.conn;
  }

  // ✅ Create new connection if not cached
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(mongoURI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      .then((mongooseInstance) => {
        console.log(`✅ MongoDB connected: ${mongooseInstance.connection.host}`);
        return mongooseInstance.connection;
      })
      .catch((error) => {
        console.error("❌ MongoDB connection failed:", error.message);
        throw error;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
};

module.exports = connectDB;
