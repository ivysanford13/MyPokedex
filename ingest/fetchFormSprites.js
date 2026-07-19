// Run this once (npm run fetch-form-sprites) to build data/form_sprites.json.
//
// The sprite artwork for alternate forms (Alolan, Galarian, Mega, etc.) lives
// under a DIFFERENT numeric id than the species' national dex number in
// PokeAPI's sprite repo. This script looks up that id for every form tracked
// in data/movepool.json, by matching against PokeAPI's pokemon-species
// "varieties" list (which uses its own naming, e.g. "vulpix-alola" instead of
// PvPoke's "vulpix_alolan").
//
// Requires data/base_stats.json and data/movepool.json to already exist
// (run fetch-stats and fetch-movepool first).
//
// Output shape: { "vulpix_alolan": 10091, "meowth_galarian": 10161, ... }
// Only forms that could be confidently matched are included -- anything
// missing here just falls back to the species' standard artwork, which is
// what already happens today, so this is a safe, additive improvement.
//
// Usage: node ingest/fetchFormSprites.js

const fs = require("fs");
const path = require("path");

const BASE_STATS_PATH = path.join(__dirname, "..", "data", "base_stats.json");
const MOVEPOOL_PATH = path.join(__dirname, "..", "data", "movepool.json");
const OUT_PATH = path.join(__dirname, "..", "data", "form_sprites.json");

// Turns a human label like "Alolan" or "Mega X" into a normalized token that
// can be compared against PokeAPI's variety-name suffixes.
function normalize(label) {
  return label
    .toLowerCase()
    .replace(/\bian\b/g, "") // "Hisuian" -> "Hisu" ... handled below with stem list instead
    .replace(/[^a-z0-9]+/g, "");
}

// Common suffix stems, mapped from our label wording to PokeAPI's own wording.
const STEM_MAP = {
  alolan: "alola", galarian: "galar", hisuian: "hisui", paldean: "paldea",
  megax: "megax", megay: "megay", mega: "mega",
  gigantamax: "gmax", primal: "primal",
};

function canonicalStem(label) {
  const n = normalize(label);
  for (const [ours, theirs] of Object.entries(STEM_MAP)) {
    if (n.includes(ours)) return theirs;
  }
  return n; // fall back to the raw normalized label for one-off legendary forms
}

async function fetchFormSprites() {
  if (!fs.existsSync(BASE_STATS_PATH) || !fs.existsSync(MOVEPOOL_PATH)) {
    console.error("Run `npm run fetch-stats` and `npm run fetch-movepool` first.");
    process.exit(1);
  }
  const baseStats = JSON.parse(fs.readFileSync(BASE_STATS_PATH, "utf8"));
  const movepool = JSON.parse(fs.readFileSync(MOVEPOOL_PATH, "utf8"));

  const results = {};
  let speciesChecked = 0;
  let formsMatched = 0;

  for (const [speciesName, entry] of Object.entries(movepool)) {
    if (!entry.forms || entry.forms.length <= 1) continue; // nothing to look up
    const base = baseStats[speciesName];
    if (!base) continue;

    speciesChecked++;
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${base.id}`);
      if (!res.ok) continue;
      const species = await res.json();

      // variety.pokemon.url looks like ".../pokemon/10091/" -- pull the id out.
      const varieties = (species.varieties || [])
        .filter((v) => !v.is_default)
        .map((v) => {
          const match = v.pokemon.url.match(/\/pokemon\/(\d+)\//);
          return { name: v.pokemon.name, id: match ? Number(match[1]) : null };
        })
        .filter((v) => v.id !== null);

      for (const form of entry.forms) {
        if (form.label === "Standard") continue;
        const stem = canonicalStem(form.label);
        const match = varieties.find((v) => v.name.replace(/-/g, "").includes(stem.replace(/-/g, "")));
        if (match) {
          results[form.id] = match.id;
          formsMatched++;
        }
      }
    } catch (err) {
      console.warn(`Skipped ${speciesName}: ${err.message}`);
    }

    if (speciesChecked % 25 === 0) console.log(`Checked ${speciesChecked} species...`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Done. Matched ${formsMatched} form sprites across ${speciesChecked} species to ${OUT_PATH}`);
}

fetchFormSprites().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});