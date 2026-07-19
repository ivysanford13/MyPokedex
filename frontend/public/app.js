// My Pokédex — frontend logic. Plain JS, no build step; served statically by Express.

const API_BASE = window.location.origin;
const TAG_COLORS = ["#c50404", "#d35f24", "#e7c712", "#008402", "#159770", "#148ec7", "#2047e6", "#7550e3", "#4c11b8", "#eb39b9"];

let baseStatsBySpecies = {}; // lowercase species name -> { id, attack, defense, stamina }
let cpMultipliers = {}; // level (string) -> multiplier
let movepoolBySpecies = {}; // lowercase species name -> { forms: [{ id, label, types, fastMoves, chargedMoves }, ...] }
let formSpriteIds = {}; // PvPoke form id (e.g. "vulpix_alolan") -> PokeAPI sprite id, for forms with distinct artwork

async function loadGameData() {
  try {
    const [stats, cpm] = await Promise.all([
      fetch(`${API_BASE}/data/base_stats.json`).then((r) => r.json()),
      fetch(`${API_BASE}/data/cp_multipliers.json`).then((r) => r.json()),
    ]);
    baseStatsBySpecies = stats;
    cpMultipliers = cpm.levels;
  } catch (err) {
    console.warn("Could not load game data (sprites/level calc will be limited):", err);
  }

  try {
    const res = await fetch(`${API_BASE}/data/movepool.json`);
    if (res.ok) movepoolBySpecies = await res.json();
  } catch (err) {
    console.warn("Could not load movepool data (type/move dropdowns will be limited):", err);
  }

  try {
    const res = await fetch(`${API_BASE}/data/form_sprites.json`);
    if (res.ok) formSpriteIds = await res.json();
  } catch (err) {
    console.warn("Could not load form sprite data (alt forms will use standard artwork):", err);
  }
}

const TYPE_COLORS = {
  normal: "#CFC38D", fire: "#FBA54C", water: "#5EABE1", electric: "#F2DA53",
  grass: "#5CC06A", ice: "#81D6CB", fighting: "#E2434D", poison: "#B362CC",
  ground: "#DA7A4A", flying: "#99B0E2", psychic: "#F95587", bug: "#A6B91A",
  rock: "#B6A136", ghost: "#735797", dragon: "#6F35FC", dark: "#705746",
  steel: "#B7B7CE", fairy: "#EF93E6",
};

function typeBadgeHtml(types) {
  return (types || [])
    .filter((t) => t && t !== "none")
    .map((t) => `<span class="type-badge" style="background:${TYPE_COLORS[t] || "#888"}">${t}</span>`)
    .join("");
}

// Resolves the correct form entry (types/moves) for a saved Pokemon, based on
// its stored `form` field (the PvPoke speciesId), falling back to the standard
// (first) form if none was recorded or the species has just one form.
function resolveForm(p) {
  const entry = movepoolBySpecies[p.species.toLowerCase().trim()];
  if (!entry || !entry.forms || entry.forms.length === 0) return null;
  if (p.form) {
    const match = entry.forms.find((f) => f.id === p.form);
    if (match) return match;
  }
  return entry.forms[0];
}

let state = {
  token: localStorage.getItem("dex_token") || null,
  pokemon: [],
  tags: [],
  activeTag: null,
  activeTab: "pokemon",
  isSignupMode: false,
  chatHistory: [],
  search: "",
  filters: { attackIv: "", defenseIv: "", staminaIv: "", stars: "", type: "" },
  sort: "cp-desc",
  selectMode: false,
  selectedPokemonIds: new Set(),
};

// ── DOM refs ──
const $ = (id) => document.getElementById(id);

// ── Toast helper ──
function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = "toast" + (isError ? " error" : "");
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

// ── API helper ──
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    // Token expired or invalid — send back to login instead of showing a raw error.
    state.token = null;
    localStorage.removeItem("dex_token");
    $("app-screen").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("auth-error").textContent = "Your session expired — please log in again.";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════

function setAuthMode(signup) {
  state.isSignupMode = signup;
  $("auth-submit").textContent = signup ? "Sign up" : "Log in";
  $("auth-toggle").textContent = signup
    ? "Already have an account? Log in"
    : "Need an account? Sign up";
  $("auth-error").textContent = "";
}

$("auth-toggle").addEventListener("click", () => setAuthMode(!state.isSignupMode));

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const errorEl = $("auth-error");
  errorEl.textContent = "";

  try {
    const endpoint = state.isSignupMode ? "/api/auth/signup" : "/api/auth/login";
    const data = await api(endpoint, { method: "POST", body: JSON.stringify({ email, password }) });

    if (state.isSignupMode && data.needs_email_confirmation) {
      errorEl.textContent = "Check your email to confirm your account, then log in.";
      setAuthMode(false);
      return;
    }

    state.token = data.access_token;
    localStorage.setItem("dex_token", state.token);
    enterApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

$("logout-btn").addEventListener("click", () => {
  state.token = null;
  localStorage.removeItem("dex_token");
  $("app-screen").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
  $("auth-form").reset();
});

async function enterApp() {
  $("auth-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
  await Promise.all([loadTags(), loadPokemon()]);
}

// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    state.activeTab = btn.dataset.tab;
  });
});

function goToPokemonTab() {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  document.querySelector('[data-tab="pokemon"]').classList.add("active");
  $("tab-pokemon").classList.remove("hidden");
  state.activeTab = "pokemon";
}

// ══════════════════════════════════════════════
// POKEMON TAB
// ══════════════════════════════════════════════

async function loadPokemon() {
  try {
    const query = state.activeTag ? `?tag=${encodeURIComponent(state.activeTag)}` : "";
    state.pokemon = await api(`/api/pokemon${query}`);
    renderPokemonGrid();
  } catch (err) {
    showToast(err.message, true);
  }
}

const STAR_SVG = `<svg viewBox="0 0 24 24"><path d="M12 3.5l2.4 5.8 6.1.5-4.7 4 1.5 6-5.3-3.4-5.3 3.4 1.5-6-4.7-4 6.1-.5z"/></svg>`;

// Builds an ordered list of sprite URLs to try, most specific first
// (shiny+female -> shiny -> female -> default), falling back gracefully
// since most species don't have gender-specific or shiny artwork available.
function spriteUrls(species, isShiny, gender, formId) {
  const entry = baseStatsBySpecies[species.toLowerCase().trim()];
  if (!entry) return [];
  const base = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/";
  // Prefer the form-specific artwork id (e.g. Alolan Vulpix) if we have one on file;
  // otherwise fall back to the species' standard national dex id.
  const id = (formId && formSpriteIds[formId]) || entry.id;
  const urls = [];
  if (isShiny && gender === "female") urls.push(`${base}shiny/female/${id}.png`);
  if (isShiny) urls.push(`${base}shiny/${id}.png`);
  if (gender === "female") urls.push(`${base}female/${id}.png`);
  urls.push(`${base}${id}.png`);
  // If a form-specific id was used, fall back to the standard artwork as a last resort.
  if (formId && formSpriteIds[formId]) urls.push(`${base}${entry.id}.png`);
  return urls;
}

// Called via onerror on sprite <img> tags — steps through the fallback chain,
// and swaps in a placeholder once every option has been exhausted.
window.trySpriteFallback = function (img) {
  let urls = [];
  try { urls = JSON.parse(img.dataset.fallbacks || "[]"); } catch { /* ignore */ }
  const nextIdx = Number(img.dataset.idx || 0) + 1;
  if (nextIdx < urls.length) {
    img.dataset.idx = nextIdx;
    img.src = urls[nextIdx];
  } else {
    img.replaceWith(Object.assign(document.createElement("div"), {
      className: "poke-sprite-fallback",
      textContent: "?",
    }));
  }
};

function getDisplayedPokemon() {
  let list = state.pokemon.slice();

  // Search (species or nickname, case-insensitive substring match)
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((p) =>
      p.species.toLowerCase().includes(q) || (p.nickname || "").toLowerCase().includes(q)
    );
  }

  // Exact IV filters
  const { attackIv, defenseIv, staminaIv, stars, type } = state.filters;
  if (attackIv !== "") list = list.filter((p) => p.attack_iv === Number(attackIv));
  if (defenseIv !== "") list = list.filter((p) => p.defense_iv === Number(defenseIv));
  if (staminaIv !== "") list = list.filter((p) => p.stamina_iv === Number(staminaIv));
  if (stars !== "") list = list.filter((p) => p.iv_stars === Number(stars));
  if (type !== "") {
    list = list.filter((p) => {
      const types = resolveForm(p)?.types || [];
      return types.includes(type);
    });
  }

  // Sort
  const [sortField, sortDir] = state.sort.split("-");
  const dir = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    if (sortField === "cp") return (a.cp - b.cp) * dir;
    if (sortField === "stars") return ((a.iv_stars ?? -1) - (b.iv_stars ?? -1)) * dir;
    if (sortField === "name") return a.species.localeCompare(b.species) * dir;
    if (sortField === "number") {
      const idA = baseStatsBySpecies[a.species.toLowerCase().trim()]?.id ?? 0;
      const idB = baseStatsBySpecies[b.species.toLowerCase().trim()]?.id ?? 0;
      return (idA - idB) * dir;
    }
    return 0;
  });

  return list;
}

function renderPokemonGrid() {
  const grid = $("pokemon-grid");
  const empty = $("pokemon-empty");
  const noMatch = $("pokemon-no-match");
  grid.innerHTML = "";

  if (state.pokemon.length === 0) {
    empty.classList.remove("hidden");
    noMatch.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");

  const displayed = getDisplayedPokemon();

  if (displayed.length === 0) {
    noMatch.classList.remove("hidden");
    return;
  }
  noMatch.classList.add("hidden");

  for (const p of displayed) {
    const card = document.createElement("div");
    card.className = "poke-card" + (state.selectMode && state.selectedPokemonIds.has(p.id) ? " is-selected" : "");
    card.addEventListener("click", (e) => {
      if (state.selectMode) {
        if (e.target.closest(".poke-card-fav")) return;
        toggleSelectPokemon(p.id);
        return;
      }
      if (e.target.closest(".poke-card-fav")) return;
      openPokemonModal(p);
    });

    const tagDots = (p.tags || [])
      .map((t) => `<span class="tag-dot" style="background:${t.color}" title="${escapeHtml(t.name)}"></span>`)
      .join("");

    const icons = [
      p.is_shiny ? `<span title="Shiny">✨</span>` : "",
      p.is_lucky ? `<span title="Lucky">🫧</span>` : "",
    ].join("");

    const pills = [
      p.is_shadow ? `<span class="pill pill-shadow">Shadow</span>` : "",
      p.is_purified ? `<span class="pill pill-purified">Purified</span>` : "",
    ].join("");

    const spriteChain = spriteUrls(p.species, p.is_shiny, p.gender, p.form);
    const spriteHtml = spriteChain.length > 0
      ? `<img class="poke-sprite" src="${spriteChain[0]}" data-fallbacks='${escapeHtml(JSON.stringify(spriteChain))}' data-idx="0" alt="${escapeHtml(p.species)}"
             onerror="trySpriteFallback(this)" />`
      : `<div class="poke-sprite-fallback">?</div>`;

    const isSelected = state.selectMode && state.selectedPokemonIds.has(p.id);

    card.innerHTML = `
      ${state.selectMode
        ? `<div class="poke-card-select-dot ${isSelected ? "checked" : ""}"></div>`
        : `<button class="poke-card-fav ${p.is_favorited ? "is-fav" : ""}" title="Favorite">${STAR_SVG}</button>`
      }
      <div class="poke-card-cp">
        <span class="cp-label">CP</span>
        <span class="cp-value">${p.cp}</span>
      </div>
      <div class="poke-card-sprite-row">
        <div class="poke-card-tags">${tagDots}</div>
        ${spriteHtml}
        <div class="poke-card-icons">${icons}</div>
      </div>
      <div class="poke-card-name">${escapeHtml(p.nickname || p.species)}</div>
      <div class="type-badge-row">${typeBadgeHtml(resolveForm(p)?.types)}</div>
      <div class="poke-card-pills">${pills}</div>
    `;

    if (!state.selectMode) {
      card.querySelector(".poke-card-fav").addEventListener("click", async () => {
        try {
          await api(`/api/pokemon/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ is_favorited: !p.is_favorited }),
          });
          loadPokemon();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

$("clear-tag-filter").addEventListener("click", () => {
  state.activeTag = null;
  $("active-tag-filter").classList.add("hidden");
  loadPokemon();
});

// ── Search / filter / sort toolbar ──
function populateIvDropdown(id) {
  const select = $(id);
  for (let i = 0; i <= 15; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    select.appendChild(opt);
  }
}
["filter-attack-iv", "filter-defense-iv", "filter-stamina-iv"].forEach(populateIvDropdown);

function populateTypeDropdown() {
  const select = $("filter-type");
  for (const type of Object.keys(TYPE_COLORS)) {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    select.appendChild(opt);
  }
}
populateTypeDropdown();

$("search-input").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderPokemonGrid();
});

$("filter-toggle-btn").addEventListener("click", () => {
  $("filter-panel").classList.toggle("hidden");
});

$("filter-attack-iv").addEventListener("change", (e) => {
  state.filters.attackIv = e.target.value;
  renderPokemonGrid();
});
$("filter-defense-iv").addEventListener("change", (e) => {
  state.filters.defenseIv = e.target.value;
  renderPokemonGrid();
});
$("filter-stamina-iv").addEventListener("change", (e) => {
  state.filters.staminaIv = e.target.value;
  renderPokemonGrid();
});
$("filter-stars").addEventListener("change", (e) => {
  state.filters.stars = e.target.value;
  renderPokemonGrid();
});
$("filter-type").addEventListener("change", (e) => {
  state.filters.type = e.target.value;
  renderPokemonGrid();
});
$("clear-filters-btn").addEventListener("click", () => {
  state.filters = { attackIv: "", defenseIv: "", staminaIv: "", stars: "", type: "" };
  $("filter-attack-iv").value = "";
  $("filter-defense-iv").value = "";
  $("filter-stamina-iv").value = "";
  $("filter-stars").value = "";
  $("filter-type").value = "";
  renderPokemonGrid();
});

$("sort-select").addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderPokemonGrid();
});

// ── Add/edit Pokemon modal ──
let editingPokemonId = null;
let selectedTagIds = new Set();

function renderTagPicker() {
  const picker = $("pf-tag-picker");
  picker.innerHTML = "";
  for (const tag of state.tags) {
    const chip = document.createElement("div");
    chip.className = "tag-pick-chip" + (selectedTagIds.has(tag.id) ? " selected" : "");
    chip.innerHTML = `<span class="tag-dot" style="background:${tag.color}"></span> ${escapeHtml(tag.name)}`;
    chip.addEventListener("click", () => {
      if (selectedTagIds.has(tag.id)) selectedTagIds.delete(tag.id);
      else selectedTagIds.add(tag.id);
      renderTagPicker();
    });
    picker.appendChild(chip);
  }
  if (state.tags.length === 0) {
    picker.innerHTML = `<span style="color:var(--text-faint);font-size:12px;">No tags yet — create one in the Tags tab.</span>`;
  }
}

// Populates fast/charged move dropdowns from a specific form's movepool.
// Preserves the previous selection if it's still valid for the new form.
function updateMoveDropdowns(formData) {
  const fastSelect = $("pf-fast-move");
  const chargedSelect = $("pf-charged-move");
  const prevFast = fastSelect.value;
  const prevCharged = chargedSelect.value;

  if (!formData) {
    fastSelect.innerHTML = `<option value="">— Type species first —</option>`;
    chargedSelect.innerHTML = `<option value="">— Type species first —</option>`;
    return;
  }

  fastSelect.innerHTML = `<option value="">—</option>` + formData.fastMoves
    .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${m.type})</option>`)
    .join("");
  chargedSelect.innerHTML = `<option value="">—</option>` + formData.chargedMoves
    .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${m.type})</option>`)
    .join("");

  if (formData.fastMoves.some((m) => m.name === prevFast)) fastSelect.value = prevFast;
  if (formData.chargedMoves.some((m) => m.name === prevCharged)) chargedSelect.value = prevCharged;
}

// Updates the form dropdown, type display, and move dropdowns whenever the
// species field changes. `presetFormId` (used when opening the edit modal)
// selects that form immediately instead of defaulting to Standard.
function updateSpeciesDependentFields(presetFormId) {
  const speciesKey = $("pf-species").value.toLowerCase().trim();
  const data = movepoolBySpecies[speciesKey];
  const formRow = $("pf-form-row");
  const formSelect = $("pf-form");

  if (!data || !data.forms || data.forms.length === 0) {
    formRow.classList.add("hidden");
    formSelect.innerHTML = "";
    $("pf-type-display").innerHTML = "";
    updateMoveDropdowns(null);
    return;
  }

  if (data.forms.length > 1) {
    formSelect.innerHTML = data.forms.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join("");
    formSelect.value = presetFormId && data.forms.some((f) => f.id === presetFormId) ? presetFormId : data.forms[0].id;
    formRow.classList.remove("hidden");
  } else {
    formRow.classList.add("hidden");
    formSelect.innerHTML = `<option value="${data.forms[0].id}">${data.forms[0].label}</option>`;
  }

  const activeForm = data.forms.find((f) => f.id === formSelect.value) || data.forms[0];
  $("pf-type-display").innerHTML = typeBadgeHtml(activeForm.types);
  updateMoveDropdowns(activeForm);
}

$("pf-species").addEventListener("input", () => updateSpeciesDependentFields());
$("pf-form").addEventListener("change", () => {
  const speciesKey = $("pf-species").value.toLowerCase().trim();
  const data = movepoolBySpecies[speciesKey];
  if (!data) return;
  const activeForm = data.forms.find((f) => f.id === $("pf-form").value) || data.forms[0];
  $("pf-type-display").innerHTML = typeBadgeHtml(activeForm.types);
  updateMoveDropdowns(activeForm);
});

function openPokemonModal(pokemon = null) {
  editingPokemonId = pokemon ? pokemon.id : null;
  selectedTagIds = new Set((pokemon?.tags || []).map((t) => t.id));

  $("pf-species").value = pokemon?.species || "";
  $("pf-nickname").value = pokemon?.nickname || "";
  $("pf-gender").value = pokemon?.gender || "";
  $("pf-cp").value = pokemon?.cp || "";
  $("pf-level").value = pokemon?.level || "";
  $("pf-attack-iv").value = pokemon?.attack_iv ?? "";
  $("pf-defense-iv").value = pokemon?.defense_iv ?? "";
  $("pf-stamina-iv").value = pokemon?.stamina_iv ?? "";
  $("pf-stars").value = pokemon?.iv_stars ?? "";
  updateSpeciesDependentFields(pokemon?.form || null);
  $("pf-fast-move").value = pokemon?.fast_move || "";
  $("pf-charged-move").value = pokemon?.charged_move || "";
  $("pf-shiny").checked = !!pokemon?.is_shiny;
  $("pf-shadow").checked = !!pokemon?.is_shadow;
  $("pf-purified").checked = !!pokemon?.is_purified;
  $("pf-lucky").checked = !!pokemon?.is_lucky;
  $("pf-favorited").checked = !!pokemon?.is_favorited;
  $("pf-transfer-btn").classList.toggle("hidden", !pokemon);

  document.querySelector("#pokemon-modal .modal-head h2").textContent =
    pokemon ? "Edit Pokémon" : "Add Pokémon";

  renderTagPicker();
  $("pokemon-modal").classList.remove("hidden");
}

$("pf-transfer-btn").addEventListener("click", async () => {
  if (!editingPokemonId) return;
  const speciesName = $("pf-species").value || "this Pokémon";
  if (!confirm(`Transfer ${speciesName}? This removes it from your collection here and can't be undone.`)) return;
  try {
    await api(`/api/pokemon/${editingPokemonId}`, { method: "DELETE" });
    $("pokemon-modal").classList.add("hidden");
    showToast("Transferred");
    loadPokemon();
  } catch (err) {
    showToast(err.message, true);
  }
});

$("add-pokemon-btn").addEventListener("click", () => openPokemonModal());

// ── Multi-select mode ──
function toggleSelectPokemon(id) {
  if (state.selectedPokemonIds.has(id)) state.selectedPokemonIds.delete(id);
  else state.selectedPokemonIds.add(id);
  updateBulkActionBar();
  renderPokemonGrid();
}

function updateBulkActionBar() {
  const count = state.selectedPokemonIds.size;
  $("bulk-selected-count").textContent = `${count} selected`;
  $("bulk-action-bar").classList.toggle("hidden", !state.selectMode);
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedPokemonIds.clear();
  $("select-mode-btn").textContent = "Select";
  updateBulkActionBar();
  renderPokemonGrid();
}

$("select-mode-btn").addEventListener("click", () => {
  state.selectMode = !state.selectMode;
  state.selectedPokemonIds.clear();
  $("select-mode-btn").textContent = state.selectMode ? "Cancel select" : "Select";
  updateBulkActionBar();
  renderPokemonGrid();
});

$("bulk-cancel-btn").addEventListener("click", exitSelectMode);

function populateBulkTagSelect() {
  const select = $("bulk-tag-select");
  select.innerHTML = `<option value="">Apply tag...</option>` + state.tags
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
    .join("");
}

$("bulk-tag-select").addEventListener("change", async (e) => {
  const tagId = e.target.value;
  if (!tagId || state.selectedPokemonIds.size === 0) return;

  const selected = state.pokemon.filter((p) => state.selectedPokemonIds.has(p.id));
  try {
    await Promise.all(selected.map((p) => {
      const currentTagIds = (p.tags || []).map((t) => t.id);
      if (currentTagIds.includes(tagId)) return Promise.resolve();
      return api(`/api/pokemon/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tagIds: [...currentTagIds, tagId] }),
      });
    }));
    showToast(`Tag applied to ${selected.length} Pokémon`);
    exitSelectMode();
    loadPokemon();
  } catch (err) {
    showToast(err.message, true);
  }
  e.target.value = "";
});

$("bulk-transfer-btn").addEventListener("click", async () => {
  const count = state.selectedPokemonIds.size;
  if (count === 0) return;
  if (!confirm(`Transfer ${count} Pokémon? This can't be undone.`)) return;

  try {
    await Promise.all([...state.selectedPokemonIds].map((id) =>
      api(`/api/pokemon/${id}`, { method: "DELETE" })
    ));
    showToast(`Transferred ${count} Pokémon`);
    exitSelectMode();
    loadPokemon();
  } catch (err) {
    showToast(err.message, true);
  }
});
$("close-pokemon-modal").addEventListener("click", () => $("pokemon-modal").classList.add("hidden"));
$("pokemon-modal").addEventListener("click", (e) => {
  if (e.target.id === "pokemon-modal") $("pokemon-modal").classList.add("hidden");
});

$("pokemon-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    species: $("pf-species").value.trim(),
    nickname: $("pf-nickname").value.trim() || null,
    gender: $("pf-gender").value || null,
    form: $("pf-form-row").classList.contains("hidden") ? null : ($("pf-form").value || null),
    cp: Number($("pf-cp").value),
    level: $("pf-level").value ? Number($("pf-level").value) : null,
    attack_iv: $("pf-attack-iv").value !== "" ? Number($("pf-attack-iv").value) : null,
    defense_iv: $("pf-defense-iv").value !== "" ? Number($("pf-defense-iv").value) : null,
    stamina_iv: $("pf-stamina-iv").value !== "" ? Number($("pf-stamina-iv").value) : null,
    iv_stars: $("pf-stars").value !== "" ? Number($("pf-stars").value) : null,
    fast_move: $("pf-fast-move").value.trim() || null,
    charged_move: $("pf-charged-move").value.trim() || null,
    is_shiny: $("pf-shiny").checked,
    is_shadow: $("pf-shadow").checked,
    is_purified: $("pf-purified").checked,
    is_lucky: $("pf-lucky").checked,
    is_favorited: $("pf-favorited").checked,
    tagIds: Array.from(selectedTagIds),
  };

  try {
    if (editingPokemonId) {
      await api(`/api/pokemon/${editingPokemonId}`, { method: "PATCH", body: JSON.stringify(body) });
      showToast("Pokémon updated");
    } else {
      await api(`/api/pokemon`, { method: "POST", body: JSON.stringify(body) });
      showToast("Pokémon added");
    }
    $("pokemon-modal").classList.add("hidden");
    loadPokemon();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ══════════════════════════════════════════════
// TAGS TAB
// ══════════════════════════════════════════════

async function loadTags() {
  try {
    state.tags = await api("/api/tags");
    renderTagList();
    populateBulkTagSelect();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderTagList() {
  const list = $("tag-list");
  const empty = $("tags-empty");
  list.innerHTML = "";

  if (state.tags.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const tag of state.tags) {
    const row = document.createElement("div");
    row.className = "tag-row";
    row.innerHTML = `
      <span class="tag-dot" style="background:${tag.color}"></span>
      <span class="tag-row-name">${escapeHtml(tag.name)}</span>
      <span class="tag-row-count">${tag.pokemon_count}</span>
      <button class="tag-row-edit" title="Edit tag">✎</button>
      <button class="tag-row-delete" title="Delete tag">✕</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".tag-row-delete") || e.target.closest(".tag-row-edit")) return;
      state.activeTag = tag.name;
      $("active-tag-name").textContent = tag.name;
      $("active-tag-filter").classList.remove("hidden");
      goToPokemonTab();
      loadPokemon();
    });
    row.querySelector(".tag-row-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openTagModal(tag);
    });
    row.querySelector(".tag-row-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete tag "${tag.name}"? Pokémon keep their other tags.`)) return;
      try {
        await api(`/api/tags/${tag.id}`, { method: "DELETE" });
        loadTags();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    list.appendChild(row);
  }
}

let selectedTagColor = TAG_COLORS[0];

function renderColorPicker() {
  const picker = $("tf-color-picker");
  picker.innerHTML = "";
  for (const color of TAG_COLORS) {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch" + (color === selectedTagColor ? " selected" : "");
    swatch.style.background = color;
    swatch.addEventListener("click", () => {
      selectedTagColor = color;
      renderColorPicker();
    });
    picker.appendChild(swatch);
  }
}

let editingTagId = null;

function openTagModal(tag = null) {
  editingTagId = tag ? tag.id : null;
  $("tf-name").value = tag ? tag.name : "";
  selectedTagColor = tag ? tag.color : TAG_COLORS[0];
  document.querySelector("#tag-modal .modal-head h2").textContent = tag ? "Edit tag" : "Create tag";
  document.querySelector("#tag-form button[type=submit]").textContent = tag ? "Save tag" : "Create tag";
  renderColorPicker();
  $("tag-modal").classList.remove("hidden");
}

$("add-tag-btn").addEventListener("click", () => openTagModal());
$("close-tag-modal").addEventListener("click", () => $("tag-modal").classList.add("hidden"));
$("tag-modal").addEventListener("click", (e) => {
  if (e.target.id === "tag-modal") $("tag-modal").classList.add("hidden");
});

$("tag-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    if (editingTagId) {
      await api(`/api/tags/${editingTagId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: $("tf-name").value.trim(), color: selectedTagColor }),
      });
      showToast("Tag updated");
    } else {
      await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: $("tf-name").value.trim(), color: selectedTagColor }),
      });
      showToast("Tag created");
    }
    $("tag-modal").classList.add("hidden");
    loadTags();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ══════════════════════════════════════════════
// CHAT TAB
// ══════════════════════════════════════════════

function appendChatBubble(role, text, sources = []) {
  const container = $("chat-messages");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;

  if (sources.length > 0) {
    const sourcesEl = document.createElement("div");
    sourcesEl.className = "chat-sources";
    sourcesEl.innerHTML = sources
      .map((s) => `<span class="chat-source-chip">${escapeHtml(s)}</span>`)
      .join("");
    bubble.appendChild(sourcesEl);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const message = input.value.trim();
  if (!message) return;

  appendChatBubble("user", message);
  input.value = "";

  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ message }) });
    appendChatBubble("assistant", data.reply || "(no response)");
  } catch (err) {
    appendChatBubble("error", `Couldn't get a response: ${err.message}`);
  }
});

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════

loadGameData();

if (state.token) {
  enterApp().catch(() => {
    // token might be expired/invalid — fall back to login
    state.token = null;
    localStorage.removeItem("dex_token");
  });
}
