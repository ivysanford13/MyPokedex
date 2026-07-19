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

  // Some species (Zacian, Ho-Oh, Mr. Mime, Tapu Koko, etc.) don't have a plain
  // unsuffixed entry in PvPoke's data at all -- their only form(s) always carry
  // a suffix, whether because the name itself has an underscore or because the
  // species requires picking a default form (e.g. zacian_hero vs zacian_crowned_sword).
  // This map picks a sensible default "catchable" form for the latter group.
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

  // For each dex number, pick one representative entry:
  //  1. Prefer a plain unsuffixed name if one exists (e.g. "venusaur" over "venusaur_mega") --
  //     this correctly skips mega/alolan/galarian/hisuian/regional variants.
  //  2. Otherwise use PREFERRED_FORM if this dex number needs an explicit default.
  //  3. Otherwise fall back to the first non-shadow entry (covers names that always
  //     carry an underscore, like "mr_mime" or "tapu_koko", where there's only one anyway).
  const baseFormByDex = {};
  const byDex = {};
  for (const p of gm.pokemon) {
    if (p.speciesId.endsWith("_shadow")) continue;
    (byDex[p.dex] ??= []).push(p);
  }
  for (const [dex, entries] of Object.entries(byDex)) {
    const plain = entries.find((e) => !e.speciesId.includes("_"));
    if (plain) {
      baseFormByDex[dex] = plain;
    } else if (PREFERRED_FORM[dex]) {
      baseFormByDex[dex] = entries.find((e) => e.speciesId === PREFERRED_FORM[dex]) || entries[0];
    } else {
      baseFormByDex[dex] = entries[0];
    }
  }

  const results = {};
  let matched = 0;

  for (const [dex, speciesName] of Object.entries(nameById)) {
    const entry = baseFormByDex[dex];
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
  console.log("Note: mega/regional/gigantamax forms use the base form's data, not tracked separately.");
}

fetchMovepool().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
