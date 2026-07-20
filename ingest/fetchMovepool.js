// Run this once (npm run fetch-movepool) to build data/movepool.json.
// Source: PvPoke's open-source gamemaster.json (community-maintained, tracks
// exactly which fast/charged moves are legal per species in Pokemon GO, plus
// each species' type(s) and each move's type).
//
// Requires data/base_stats.json to already exist (run npm run fetch-stats first) --
// this script joins PvPoke's data to species names using the same id numbers,
// so the output lines up with the species keys the app already uses for sprites.
//
// Output shape: { speciesName: { forms: [ { id, label, types, fastMoves, chargedMoves }, ... ] } }
// The first form in the array is always the standard/default one. Species with
// only one form (most of them) just have a single-item array.
//
// Usage: node ingest/fetchMovepool.js

const fs = require("fs");
const path = require("path");

const GAMEMASTER_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json";
const BASE_STATS_PATH = path.join(__dirname, "..", "data", "base_stats.json");
const OUT_PATH = path.join(__dirname, "..", "data", "movepool.json");

// Some species (Zacian, Ho-Oh, Mr. Mime, Tapu Koko, etc.) don't have a plain
// unsuffixed entry in PvPoke's data at all -- their only/default form always
// carries a suffix, whether because the name itself has an underscore or because
// the species requires picking a default catchable form (e.g. zacian_hero vs
// zacian_crowned_sword). This map picks the standard form for that group.
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

// Turns a PvPoke speciesId's suffix into a readable label, e.g.
// "vulpix_alolan" -> "Alolan", "zacian_crowned_sword" -> "Crowned Sword".
function labelForSuffix(speciesId, baseName) {
  const suffix = speciesId.slice(baseName.length).replace(/^_/, "");
  if (!suffix) return "Standard";
  return suffix
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function fetchMovepool() {
  if (!fs.existsSync(BASE_STATS_PATH)) {
    console.error("data/base_stats.json not found -- run `npm run fetch-stats` first.");
    process.exit(1);
  }
  const baseStats = JSON.parse(fs.readFileSync(BASE_STATS_PATH, "utf8"));

  const nameById = {};
  for (const [name, info] of Object.entries(baseStats)) {
    nameById[info.id] = name;
  }

  console.log("Fetching PvPoke gamemaster.json...");
  const res = await fetch(GAMEMASTER_URL);
  if (!res.ok) throw new Error(`Failed to fetch gamemaster.json: ${res.status}`);
  const gm = await res.json();

  const moveById = {};
  for (const move of gm.moves) {
    moveById[move.moveId] = { id: move.moveId, name: move.name, type: move.type };
  }

  // Group all non-shadow entries by dex number.
  const byDex = {};
  for (const p of gm.pokemon) {
    if (p.speciesId.endsWith("_shadow")) continue;
    (byDex[p.dex] ??= []).push(p);
  }

  // Pick the standard/default entry for each dex number (same logic as before).
  const standardIdByDex = {};
  for (const [dex, entries] of Object.entries(byDex)) {
    const plain = entries.find((e) => !e.speciesId.includes("_"));
    if (plain) {
      standardIdByDex[dex] = plain.speciesId;
    } else if (PREFERRED_FORM[dex]) {
      standardIdByDex[dex] = PREFERRED_FORM[dex];
    } else {
      standardIdByDex[dex] = entries[0].speciesId;
    }
  }

  const results = {};
  let matched = 0;
  let totalForms = 0;

  for (const [dex, speciesName] of Object.entries(nameById)) {
    const entries = byDex[dex];
    if (!entries || entries.length === 0) continue;

    const standardId = standardIdByDex[dex];
    // Standard form first, then every other form for this dex number.
    const ordered = [
      entries.find((e) => e.speciesId === standardId),
      ...entries.filter((e) => e.speciesId !== standardId),
    ].filter(Boolean);

    results[speciesName] = {
      forms: ordered.map((entry) => ({
        id: entry.speciesId,
        label: entry.speciesId === standardId ? "Standard" : labelForSuffix(entry.speciesId, standardId.split("_")[0]),
        types: entry.types,
        baseStats: { attack: entry.baseStats.atk, defense: entry.baseStats.def, stamina: entry.baseStats.hp },
        fastMoves: (entry.fastMoves || []).map((id) => moveById[id]).filter(Boolean),
        chargedMoves: (entry.chargedMoves || []).map((id) => moveById[id]).filter(Boolean),
      })),
    };
    matched++;
    totalForms += results[speciesName].forms.length;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Done. Wrote movepool data for ${matched} species (${totalForms} forms total) to ${OUT_PATH}`);
}

fetchMovepool().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
