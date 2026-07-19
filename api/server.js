// Minimal Express server tying the routes together.
// npm install express

require("dotenv").config();
const path = require("path");
const express = require("express");
const db = require("../lib/db");
const { handleChatMessage } = require("./chat");
const pokemonRouter = require("./pokemon");
const tagsRouter = require("./tags");
const authRouter = require("./auth");
const { requireAuth } = require("../middleware/requireAuth");

const app = express();
app.use(express.json());

// Serve the frontend (index.html, style.css, app.js) as static files.
// Caching disabled so file updates always show up on a normal refresh during development.
app.use(express.static(path.join(__dirname, "..", "frontend", "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
}));
// Serve base stats + CP multiplier tables so the frontend can calculate level and find sprites
app.use("/data", express.static(path.join(__dirname, "..", "data"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
}));

app.use("/api/auth", authRouter);
app.use("/api/pokemon", pokemonRouter);
app.use("/api/tags", tagsRouter);

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("Health check DB error:", err);
    if (err.errors) {
      console.error("Sub-errors:", err.errors);
    }
    res.status(500).json({
      status: "error",
      message: err.message || err.code || (err.errors && err.errors.map(e => e.message).join("; ")) || "unknown error",
    });
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const reply = await handleChatMessage(req.body.message, {
      db,
      userId: req.userId,
      embedQuery: async () => { throw new Error("Embeddings not wired up yet"); },
    });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));