const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return next(new Error("JWT_SECRET is not configured"));
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = {
      userId: String(payload.sub || ""),
      username: String(payload.username || ""),
    };

    if (!req.auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = {
  requireAuth,
};
