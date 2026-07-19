// CRUD routes for the user's logged Pokemon (pokemon_entries table).
// Mounted at /api/pokemon in server.js
//
// Auth: every route here requires a valid Supabase access token in the
// Authorization: Bearer <token> header. The requireAuth middleware verifies
// it and attaches the logged-in user's id as req.userId.

const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// ── GET /api/pokemon ─────────────────────────────────────
// List the user's Pokemon. Supports optional filters: species, tag, min_cp, favorited.
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    const { species, tag, min_cp, favorited } = req.query;
    const conditions = ["pe.user_id = $1"];
    const params = [userId];

    if (species) {
      params.push(`%${species}%`);
      conditions.push(`pe.species ILIKE $${params.length}`);
    }
    if (min_cp) {
      params.push(Number(min_cp));
      conditions.push(`pe.cp >= $${params.length}`);
    }
    if (favorited === "true") {
      conditions.push(`pe.is_favorited = TRUE`);
    }

    let query;
    if (tag) {
      params.push(tag);
      query = `
        SELECT pe.*,
          COALESCE(
            json_agg(json_build_object('id', t2.id, 'name', t2.name, 'color', t2.color))
              FILTER (WHERE t2.id IS NOT NULL), '[]'
          ) AS tags
        FROM pokemon_entries pe
        JOIN pokemon_tags pt ON pt.pokemon_entry_id = pe.id
        JOIN tags t ON t.id = pt.tag_id AND t.name ILIKE $${params.length}
        LEFT JOIN pokemon_tags pt2 ON pt2.pokemon_entry_id = pe.id
        LEFT JOIN tags t2 ON t2.id = pt2.tag_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY pe.id
        ORDER BY pe.cp DESC
      `;
    } else {
      query = `
        SELECT pe.*,
          COALESCE(
            json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
              FILTER (WHERE t.id IS NOT NULL), '[]'
          ) AS tags
        FROM pokemon_entries pe
        LEFT JOIN pokemon_tags pt ON pt.pokemon_entry_id = pe.id
        LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY pe.id
        ORDER BY pe.cp DESC
      `;
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/pokemon error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/pokemon/:id ─────────────────────────────────
// Full detail for one entry, including its tags.
router.get("/:id", async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT pe.*,
         COALESCE(
           json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FILTER (WHERE t.id IS NOT NULL), '[]'
         ) AS tags
       FROM pokemon_entries pe
       LEFT JOIN pokemon_tags pt ON pt.pokemon_entry_id = pe.id
       LEFT JOIN tags t ON t.id = pt.tag_id
       WHERE pe.id = $1 AND pe.user_id = $2
       GROUP BY pe.id`,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pokemon not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /api/pokemon/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pokemon ────────────────────────────────────
// Create a new entry (from screenshot OCR + questionnaire, or manual entry).
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;

    const {
      species, nickname, cp, level, hp,
      attack_iv, defense_iv, stamina_iv, iv_stars,
      fast_move, charged_move, gender,
      is_shiny, is_shadow, is_purified, is_lucky, is_favorited,
      notes, tagIds,
    } = req.body;

    if (!species || cp === undefined) {
      return res.status(400).json({ error: "species and cp are required" });
    }

    const result = await db.query(
      `INSERT INTO pokemon_entries
        (user_id, species, nickname, cp, level, hp, attack_iv, defense_iv, stamina_iv, iv_stars,
         fast_move, charged_move, gender, is_shiny, is_shadow, is_purified, is_lucky, is_favorited, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        userId, species, nickname || null, cp, level || null, hp || null,
        attack_iv ?? null, defense_iv ?? null, stamina_iv ?? null, iv_stars ?? null,
        fast_move || null, charged_move || null, gender || null,
        !!is_shiny, !!is_shadow, !!is_purified, !!is_lucky, !!is_favorited,
        notes || null,
      ]
    );

    const entry = result.rows[0];

    // Attach tags if any were provided
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const values = tagIds.map((_, i) => `($1, $${i + 2})`).join(", ");
      await db.query(
        `INSERT INTO pokemon_tags (pokemon_entry_id, tag_id) VALUES ${values}`,
        [entry.id, ...tagIds]
      );
    }

    res.status(201).json(entry);
  } catch (err) {
    console.error("POST /api/pokemon error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/pokemon/:id ───────────────────────────────
// Partial update — only fields present in the body are changed.
router.patch("/:id", async (req, res) => {
  try {
    const userId = req.userId;

    const allowedFields = [
      "species", "nickname", "cp", "level", "hp",
      "attack_iv", "defense_iv", "stamina_iv", "iv_stars",
      "fast_move", "charged_move", "gender",
      "is_shiny", "is_shadow", "is_purified", "is_lucky", "is_favorited", "notes",
    ];

    const setClauses = [];
    const params = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0 && !req.body.tagIds) {
      return res.status(400).json({ error: "No fields to update" });
    }

    let entry;
    if (setClauses.length > 0) {
      setClauses.push(`updated_at = now()`);
      params.push(req.params.id, userId);
      const result = await db.query(
        `UPDATE pokemon_entries SET ${setClauses.join(", ")}
         WHERE id = $${params.length - 1} AND user_id = $${params.length}
         RETURNING *`,
        params
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pokemon not found" });
      }
      entry = result.rows[0];
    }

    // Replace tag associations if tagIds provided
    if (Array.isArray(req.body.tagIds)) {
      await db.query(`DELETE FROM pokemon_tags WHERE pokemon_entry_id = $1`, [req.params.id]);
      if (req.body.tagIds.length > 0) {
        const values = req.body.tagIds.map((_, i) => `($1, $${i + 2})`).join(", ");
        await db.query(
          `INSERT INTO pokemon_tags (pokemon_entry_id, tag_id) VALUES ${values}`,
          [req.params.id, ...req.body.tagIds]
        );
      }
    }

    res.json(entry || { id: req.params.id, tagsUpdated: true });
  } catch (err) {
    console.error("PATCH /api/pokemon/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/pokemon/:id ──────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `DELETE FROM pokemon_entries WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pokemon not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/pokemon/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;