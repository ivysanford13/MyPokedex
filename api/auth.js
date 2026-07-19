// Auth routes backed by Supabase Auth. Mounted at /api/auth in server.js
//
// Flow: signup/login return an access_token. The frontend stores that token
// and sends it back as "Authorization: Bearer <token>" on every request to
// /api/pokemon and /api/tags. requireAuth (in middleware/requireAuth.js)
// verifies that token and attaches req.userId.

const express = require("express");
const supabase = require("../lib/supabase");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// ── POST /api/auth/signup ────────────────────────────────
router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    // If email confirmation is on, session may be null until the user confirms.
    res.status(201).json({
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      access_token: data.session ? data.session.access_token : null,
      needs_email_confirmation: !data.session,
    });
  } catch (err) {
    console.error("POST /api/auth/signup error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    res.json({
      user: { id: data.user.id, email: data.user.email },
      access_token: data.session.access_token,
    });
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/logout ────────────────────────────────
// Stateless on the server side (JWTs aren't tracked here) — this just tells
// the client to discard its token. Included for a consistent API shape.
router.post("/logout", (req, res) => {
  res.json({ message: "Logged out. Discard the access token client-side." });
});

// ── GET /api/auth/me ──────────────────────────────────────
// Returns the currently authenticated user, based on the Authorization header.
router.get("/me", requireAuth, (req, res) => {
  res.json({ id: req.userId, email: req.userEmail });
});

module.exports = router;