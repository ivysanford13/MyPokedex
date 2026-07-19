// Run this once (npm run fetch-stats) to build data/base_stats.json.
// Species names/ids come from PokeAPI (free, no key needed, gives clean stable
// keys like "charizard"). The attack/defense/stamina VALUES are then swapped in
// from PvPoke's gamemaster.json, since Pokemon GO uses its own tuned stats that
// differ from the mainline games -- using PokeAPI's stats directly gives wrong
// CP/level math. Matching is done by national dex number.
//
// Usage: node ingest/fetchBaseStats.js

const fs = require("fs");
const path = require("path");

const OUT_PATH = path.join(__dirname, "..", "data", "base_stats.json");
const POKEMON_COUNT = 1025; // covers all species through recent generations; adjust as new ones release
const GAMEMASTER_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json";

// Same "pick the standard form" logic used in fetchMovepool.js, kept in sync
// so base_stats.json and movepool.json agree on which form's data represents
// a given species by default.
const PREFERRED_FORM = {
  412: "burmy_plant", 413: "wormadam_plant", 421: "cherrim_overcast",
  487: "giratina_altered", 492: "shaymin_land", 555: "darmanitan_standard",
  641: "tornadus_incarnate", 642: "thundurus_incarnate", 645: "landorus_incarnate",
  647: "keldeo_ordinary", 648: "meloetta_aria", 681: "aegislash_shield",
  710: "pumpkaboo_average", 711: "gourgeist_average", 741: "oricorio_baile",
  745: "lycanroc_midday", 774: "minior_meteor", 876: "indeedee_male",
  877: "morpeko_full_belly", 888: "zacian_hero", 889: "zamazenta_hero",
  892: "urshifu_single_strike", 902: "basculegion_male", 905: "enamorus_incarnate",
  978: "tatsugiri_curly",
};

async function fetchGoBaseStatsByDex() {
  const res = await fetch(GAMEMASTER_URL);
  if (!res.ok) throw new Error(`Failed to fetch gamemaster.json: ${res.status}`);
  const gm = await res.json();

  const byDex = {};
  for (const p of gm.pokemon) {
    if (p.speciesId.endsWith("_shadow")) continue;
    (byDex[p.dex] ??= []).push(p);
  }

  const statsByDex = {};
  for (const [dex, entries] of Object.entries(byDex)) {
    const plain = entries.find((e) => !e.speciesId.includes("_"));
    let chosen;
    if (plain) chosen = plain;
    else if (PREFERRED_FORM[dex]) chosen = entries.find((e) => e.speciesId === PREFERRED_FORM[dex]) || entries[0];
    else chosen = entries[0];
    statsByDex[dex] = chosen.baseStats; // { atk, def, hp }
  }
  return statsByDex;
}

async function fetchAll() {
  console.log("Fetching Pokemon GO base stats from PvPoke...");
  const goStatsByDex = await fetchGoBaseStatsByDex();

  const results = {};

  for (let id = 1; id <= POKEMON_COUNT; id++) {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!res.ok) continue;
      const data = await res.json();

      const goStats = goStatsByDex[id];
      if (!goStats) {
        // No PvPoke entry for this dex number (not yet released in GO) -- skip
        // rather than writing wrong/placeholder stats.
        continue;
      }

      results[data.name] = {
        id: data.id,
        attack: goStats.atk,
        defense: goStats.def,
        stamina: goStats.hp,
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
