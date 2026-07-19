// CRUD routes for tags (colored labels used to organize the Pokemon grid).
// Mounted at /api/tags in server.js
//
// Auth: every route here requires a valid Supabase access token in the
// Authorization: Bearer <token> header, verified by requireAuth.

const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// ── GET /api/tags ────────────────────────────────────────
// List all tags for the user, with a count of how many Pokemon have each one.
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT t.id, t.name, t.color, t.created_at,
              COUNT(pt.pokemon_entry_id) AS pokemon_count
       FROM tags t
       LEFT JOIN pokemon_tags pt ON pt.tag_id = t.id
       WHERE t.user_id = $1
       GROUP BY t.id
       ORDER BY t.name ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/tags error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tags ───────────────────────────────────────
// Create a new tag. name is required, color defaults to the schema default.
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;

    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const result = await db.query(
      `INSERT INTO tags (user_id, name, color)
       VALUES ($1, $2, COALESCE($3, '#378ADD'))
       RETURNING *`,
      [userId, name.trim(), color || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      // unique_violation on (user_id, name)
      return res.status(409).json({ error: "A tag with that name already exists" });
    }
    console.error("POST /api/tags error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tags/:id ──────────────────────────────────
// Rename a tag or change its color.
router.patch("/:id", async (req, res) => {
  try {
    const userId = req.userId;

    const { name, color } = req.body;
    if (name === undefined && color === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const setClauses = [];
    const params = [];
    if (name !== undefined) {
      params.push(name.trim());
      setClauses.push(`name = $${params.length}`);
    }
    if (color !== undefined) {
      params.push(color);
      setClauses.push(`color = $${params.length}`);
    }
    params.push(req.params.id, userId);

    const result = await db.query(
      `UPDATE tags SET ${setClauses.join(", ")}
       WHERE id = $${params.length - 1} AND user_id = $${params.length}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tag not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A tag with that name already exists" });
    }
    console.error("PATCH /api/tags/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tags/:id ─────────────────────────────────
// Removes the tag and its associations (pokemon entries themselves are untouched).
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `DELETE FROM tags WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tag not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/tags/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;