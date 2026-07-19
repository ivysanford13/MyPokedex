// Run this once (npm run fetch-movepool) to build data/movepool.json.
// Source: PvPoke's open-source gamemaster.json (community-maintained, tracks
// exactly which fast/charged moves are legal per species in Pokemon GO, plus
// each species' type(s) and each move's type).
//
// Requires data/base_stats.json to already exist (run npm run fetch-stats first) --
// this script joins PvPoke's data to species names using the same id numbers,
// so the output lines up with the species keys the app already uses for sprites.
//
// Usage: node ingest/fetchMovepool.js

const fs = require("fs");
const path = require("path");

const GAMEMASTER_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json";
const BASE_STATS_PATH = path.join(__dirname, "..", "data", "base_stats.json");
const OUT_PATH = path.join(__dirname, "..", "data", "movepool.json");

async function fetchMovepool() {
  if (!fs.existsSync(BASE_STATS_PATH)) {
    console.error("data/base_stats.json not found -- run `npm run fetch-stats` first.");
    process.exit(1);
  }
  const baseStats = JSON.parse(fs.readFileSync(BASE_STATS_PATH, "utf8"));

  // Invert name -> id into id -> name, so PvPoke's dex-numbered entries can be
  // matched back to the exact species keys the app already uses (from PokeAPI).
  const nameById = {};
  for (const [name, info] of Object.entries(baseStats)) {
    nameById[info.id] = name;
  }

  console.log("Fetching PvPoke gamemaster.json...");
  const res = await fetch(GAMEMASTER_URL);
  if (!res.ok) throw new Error(`Failed to fetch gamemaster.json: ${res.status}`);
  const gm = await res.json();

  // Move id -> { name, type }
  const moveById = {};
  for (const move of gm.moves) {
    moveById[move.moveId] = { id: move.moveId, name: move.name, type: move.type };
  }

  // For each dex number, prefer the plain base-form entry (no "_shadow",
  // "_mega", "_alolan", etc. suffix). Regional/mega forms are skipped for now --
  // they'd need their own separate species keys to track accurately.
  const baseFormByDex = {};
  for (const p of gm.pokemon) {
    if (p.speciesId.includes("_")) continue; // skip shadow/mega/regional forms
    if (!(p.dex in baseFormByDex)) baseFormByDex[p.dex] = p;
  }

  const results = {};
  let matched = 0;

  for (const [dex, speciesName] of Object.entries(nameById)) {
    const entry = baseFormByDex[Number(dex)];
    if (!entry) continue;

    results[speciesName] = {
      types: entry.types,
      fastMoves: (entry.fastMoves || []).map((id) => moveById[id]).filter(Boolean),
      chargedMoves: (entry.chargedMoves || []).map((id) => moveById[id]).filter(Boolean),
    };
    matched++;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Done. Wrote movepool data for ${matched} species to ${OUT_PATH}`);
  console.log("Note: regional/mega/gigantamax forms are not separately tracked yet.");
}

fetchMovepool().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});