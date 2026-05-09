const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envCandidates = [
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "..", "..", "server", ".env"),
  path.resolve(process.cwd(), ".env")
];

envCandidates.forEach((envPath) => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
});

const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");

const app = express();
const port = Number(process.env.PORT || 3001);

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, "");
  }
}

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "https://localhost:5173",
  "https://silent-voice-vc1h.vercel.app"
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins.join(","))
  .split(",")
  .map((value) => normalizeOrigin(value))
  .filter(Boolean);

const defaultAllowedOriginPatterns = ["^https://.*\\.vercel\\.app$"];
const allowedOriginPatterns = (
  process.env.ALLOWED_ORIGIN_PATTERNS || defaultAllowedOriginPatterns.join(",")
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      const matchesPattern = allowedOriginPatterns.some((pattern) =>
        pattern.test(normalizedOrigin)
      );

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(normalizedOrigin) ||
        matchesPattern
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Auth server listening on http://0.0.0.0:${port}`);
  });
}
