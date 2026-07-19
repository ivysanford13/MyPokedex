// CP / IV calculation helpers.
// baseStats: { attack, defense, stamina } — per-species base stats, needed as a lookup table (not included here).
// cpMultipliers: parsed from data/cp_multipliers.json

function calculateCP(baseStats, ivs, level, cpMultipliers) {
  const cpm = cpMultipliers.levels[String(level)];
  if (!cpm) throw new Error(`No CP multiplier for level ${level}`);

  const attack = baseStats.attack + ivs.attack;
  const defense = baseStats.defense + ivs.defense;
  const stamina = baseStats.stamina + ivs.stamina;

  const cp = Math.floor(
    (attack * Math.sqrt(defense) * Math.sqrt(stamina) * cpm * cpm) / 10
  );
  return Math.max(cp, 10); // CP floor is 10
}

// Given an OCR'd CP + HP + species base stats, find every possible IV combination
// (0-15 per stat) that produces that exact CP and HP, across all levels.
// This is necessary because CP + HP alone don't uniquely determine IVs --
// this is exactly the gap the questionnaire step fills (narrowing via the
// in-game "appraisal" stat bars, which the user selects manually).
function findCandidateIVs(baseStats, targetCP, targetHP, cpMultipliers) {
  const candidates = [];

  for (const [level, cpm] of Object.entries(cpMultipliers.levels)) {
    for (let atkIV = 0; atkIV <= 15; atkIV++) {
      for (let defIV = 0; defIV <= 15; defIV++) {
        for (let staIV = 0; staIV <= 15; staIV++) {
          const attack = baseStats.attack + atkIV;
          const defense = baseStats.defense + defIV;
          const stamina = baseStats.stamina + staIV;

          const cp = Math.floor(
            (attack * Math.sqrt(defense) * Math.sqrt(stamina) * cpm * cpm) / 10
          );
          const hp = Math.floor(stamina * cpm);

          if (cp === targetCP && hp === targetHP) {
            candidates.push({ level: Number(level), atkIV, defIV, staIV });
          }
        }
      }
    }
  }

  return candidates; // Often more than one match -- questionnaire (appraisal answers) narrows further.
}

function ivPercent(ivs) {
  return Math.round(((ivs.attack + ivs.defense + ivs.stamina) / 45) * 100);
}

module.exports = { calculateCP, findCandidateIVs, ivPercent };
