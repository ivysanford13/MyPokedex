// Run this once (npm run fetch-stats) to build data/base_stats.json from PokeAPI.
// PokeAPI is free, public, and needs no API key.
//
// Usage: node ingest/fetchBaseStats.js

const fs = require("fs");
const path = require("path");

const OUT_PATH = path.join(__dirname, "..", "data", "base_stats.json");
const POKEMON_COUNT = 1025; // covers all species through recent generations; adjust as new ones release

async function fetchAll() {
  const results = {};

  for (let id = 1; id <= POKEMON_COUNT; id++) {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!res.ok) continue;
      const data = await res.json();

      const getStat = (name) =>
        data.stats.find((s) => s.stat.name === name)?.base_stat ?? 0;

      // PokeAPI's base stats aren't 1:1 with Pokemon GO's (GO uses its own tuned
      // attack/defense/stamina values). This pulls PokeAPI's stats as a starting
      // point -- swap in GO-specific values (e.g. from a GO-specific data source
      // like PvPoke's open dataset) for accurate in-game CP calculations.
      results[data.name] = {
        id: data.id,
        attack: getStat("attack"),
        defense: getStat("defense"),
        stamina: getStat("hp"),
      };

      if (id % 50 === 0) console.log(`Fetched ${id}/${POKEMON_COUNT}...`);
    } catch (err) {
      console.warn(`Skipped id ${id}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Done. Wrote ${Object.keys(results).length} species to ${OUT_PATH}`);
}

fetchAll();
