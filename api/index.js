const dotenv = require("dotenv");
const connectDB = require("../src/config/db");
const app = require("../src/app");

dotenv.config();

let isConnected = false; // ✅ Avoid reconnecting every request

async function handler(req, res) {
  try {
    if (!isConnected) {
      await connectDB();
      isConnected = true;
      console.log("✅ Database connected (Vercel serverless)");
    }

    // ✅ Important: Express must handle the request properly
    return app(req, res);
  } catch (error) {
    console.error("❌ Request handling failed:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  }
}

module.exports = handler;
module.exports.default = handler;
