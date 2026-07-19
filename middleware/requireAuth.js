// Middleware that verifies the Authorization: Bearer <token> header against
// Supabase Auth, and attaches req.userId / req.userEmail on success.
// Use on any route that should only work for a logged-in user.

const supabase = require("../lib/supabase");

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization: Bearer <token> header" });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.userId = data.user.id;
    req.userEmail = data.user.email;
    next();
  } catch (err) {
    console.error("requireAuth error:", err);
    res.status(500).json({ error: "Auth check failed" });
  }
}

module.exports = { requireAuth };