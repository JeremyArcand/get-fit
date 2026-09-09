"use strict";

/* ================================================================
   ONGLET MON HÉROS — Phase 2.

   Deux économies distinctes :
   - Essence et or : farmables via le donjon automatique, qui tourne
     tout seul avec le temps (et rattrape le temps hors-ligne).
   - Gemmes : uniquement via une montée de niveau, donc uniquement
     via une vraie séance loggée dans workout.js.
   ================================================================ */

const DUNGEON_TICK_SECONDS = 1;
const BOSS_TIME_LIMIT_SECONDS = 60;
const MAX_OFFLINE_SECONDS = 1800; // 30 min de rattrapage maximum
const DUNGEON_MAX_STAGE = 10;

// Un monstre par palier ; le palier 10 est le boss.
const MONSTER_ROSTER = [
  { name: "Gobelin poussif",    icon: "👺" },
  { name: "Loup des landes",    icon: "🐺" },
  { name: "Golem de pierre",    icon: "🗿" },
  { name: "Spectre affamé",     icon: "👻" },
  { name: "Ogre bedonnant",     icon: "👹" },
  { name: "Basilic endormi",    icon: "🐍" },
  { name: "Chevalier déchu",    icon: "⚔️" },
  { name: "Hydre à deux têtes", icon: "🐉" },
  { name: "Démon de la fonte",  icon: "😈" },
  { name: "Dragon d'acier",     icon: "🐲" }
];

// Sprites du héros (frames exportées de Spritesheets.ai, 1 sur 5 conservée).
const HERO_ATTACK_FRAME_COUNT = 12;
const HERO_ATTACK_FRAME_MS = 80;
const HERO_IDLE_SRC = "assets/hero/hero-idle.png";

const LEGENDARY_CHEST_GEMS = 5;
const FORGE_GEMS = 3;
const CHEST_COMMON_PRICE = 25;
const CHEST_RARE_PRICE = 60;

const SLOT_LABELS = {
  weapon: "Arme",
  helmet: "Casque",
  chestplate: "Plastron",
  leggings: "Jambières",
  ring: "Anneau",
  necklace: "Collier"
};
const SLOT_ICONS = {
  weapon: "🗡️", helmet: "🪖", chestplate: "🛡️",
  leggings: "👖", ring: "💍", necklace: "📿"
};
const RARITY_LABELS = { common: "commune", rare: "rare", legendary: "légendaire" };

/* ================= TABLES DE BUTIN ================= */
const LOOT_COMMON = [
  { name: "Dague rouillée",       slot: "weapon",     bonus: { force: 2 } },
  { name: "Gourdin de chêne",     slot: "weapon",     bonus: { force: 3 } },
  { name: "Casque de cuir",       slot: "helmet",     bonus: { endurance: 2 } },
  { name: "Plastron matelassé",   slot: "chestplate", bonus: { endurance: 3 } },
  { name: "Jambières de toile",   slot: "leggings",   bonus: { vitesse: 2 } },
  { name: "Anneau de cuivre",     slot: "ring",       bonus: { force: 1, vitesse: 1 } },
  { name: "Amulette d'os",        slot: "necklace",   bonus: { endurance: 1, vitesse: 2 } }
];

const LOOT_RARE = [
  { name: "Lame de l'aurore",     slot: "weapon",     bonus: { force: 5, vitesse: 3 } },
  { name: "Marteau du colosse",   slot: "weapon",     bonus: { force: 6, endurance: 3 } },
  { name: "Heaume runique",       slot: "helmet",     bonus: { endurance: 5, force: 3 } },
  { name: "Égide du rempart",     slot: "chestplate", bonus: { endurance: 6, vitesse: 3 } },
  { name: "Grèves du vent",       slot: "leggings",   bonus: { vitesse: 6, force: 3 } },
  { name: "Sceau du duelliste",   slot: "ring",       bonus: { force: 4, vitesse: 4 } },
  { name: "Collier des marées",   slot: "necklace",   bonus: { endurance: 4, vitesse: 4 } }
];

// Rareté légendaire : accessible uniquement par le coffre à gemmes.
const LOOT_LEGENDARY = [
  { name: "Ruine des titans",       slot: "weapon",     bonus: { force: 10, endurance: 6 } },
  { name: "Couronne du roi déchu",  slot: "helmet",     bonus: { endurance: 8, force: 7, vitesse: 6 } },
  { name: "Carapace du dragon",     slot: "chestplate", bonus: { endurance: 10, force: 7 } },
  { name: "Foulées du mirage",      slot: "leggings",   bonus: { vitesse: 10, endurance: 6 } },
  { name: "Anneau du serment",      slot: "ring",       bonus: { force: 8, endurance: 8, vitesse: 8 } },
  { name: "Cœur d'étoile",          slot: "necklace",   bonus: { force: 9, vitesse: 9 } }
];

const LOOT_TABLES = { common: LOOT_COMMON, rare: LOOT_RARE, legendary: LOOT_LEGENDARY };

/* ================= CALCULS DE BASE ================= */
function xpForNextLevel(level){
  return 50 * level;
}

function fmtStat(v){
  return String(Math.round(v * 10) / 10).replace(".", ",");
}

function equippedItems(){
  const hero = state.hero;
  return EQUIPMENT_SLOTS
    .map(function(slot){ return findItem(hero.equipment[slot]); })
    .filter(Boolean);
}

function findItem(id){
  if(!id) return null;
  return state.hero.inventory.find(function(item){ return item.id === id; }) || null;
}

// Bonus permanents achetés avec l'essence (+0,5 par achat).
function essenceBonus(stat){
  return state.hero.essenceUpgrades[stat] * 0.5;
}

function baseStats(){
  const s = state.hero.stats;
  return {
    force: s.force + essenceBonus("force"),
    endurance: s.endurance + essenceBonus("endurance"),
    vitesse: s.vitesse + essenceBonus("vitesse")
  };
}

// Stats de base + bonus de TOUS les emplacements équipés.
function totalStats(){
  const total = baseStats();
  equippedItems().forEach(function(item){
    Object.keys(item.bonus).forEach(function(stat){
      if(total[stat] !== undefined){ total[stat] += item.bonus[stat]; }
    });
  });
  return total;
}

function totalPower(){
  const s = totalStats();
  return s.force + s.endurance + s.vitesse;
}

function bonusLabel(bonus){
  return Object.keys(bonus).map(function(stat){
    return "+" + bonus[stat] + " " + stat;
  }).join(" · ");
}

function itemDisplayName(item){
  return item.upgradeCount > 0 ? item.name + " +" + item.upgradeCount : item.name;
}

function createItem(rarity){
  const table = LOOT_TABLES[rarity] || LOOT_COMMON;
  const pick = table[Math.floor(Math.random() * table.length)];
  const bonus = {};
  Object.keys(pick.bonus).forEach(function(stat){ bonus[stat] = pick.bonus[stat]; });
  return {
    id: nextId(),
    name: pick.name,
    slot: pick.slot,
    bonus: bonus,
    rarity: rarity,
    upgradeCount: 0
  };
}

function addItem(item){
  state.hero.inventory.push(item);
  // Emplacement encore vide : on équipe directement, c'est toujours un gain.
  if(!state.hero.equipment[item.slot]){
    state.hero.equipment[item.slot] = item.id;
  }
  return item;
}

/* ================= DONJON AUTOMATIQUE ================= */
function stageDifficulty(stage){
  const base = 15 * Math.pow(1.35, stage);
  return stage === DUNGEON_MAX_STAGE ? base * 1.5 : base;
}

function winProbability(stage){
  const power = totalPower();
  const raw = power / (power + stageDifficulty(stage));
  return Math.max(0.05, Math.min(0.95, raw));
}

function rollDropRarity(stage){
  // Plus le palier est haut, plus le butin penche vers "rare".
  const rareChance = Math.min(0.6, 0.05 + stage * 0.06);
  return Math.random() < rareChance ? "rare" : "common";
}

// Résout une tentative et applique ses effets. Retourne le détail du combat.
function resolveDungeonAttempt(){
  const hero = state.hero;
  const stage = hero.dungeon.stage;
  const isBoss = stage === DUNGEON_MAX_STAGE;
  const won = Math.random() < winProbability(stage);
  const result = { stage: stage, isBoss: isBoss, won: won, essence: 0, gold: 0, item: null };

  if(won){
    const multiplier = isBoss ? 3 : 1;
    result.essence = (2 + stage) * multiplier;
    result.gold = (3 + stage * 2) * multiplier;
    hero.dungeon.essence += result.essence;   // banqué immédiatement
    hero.gold += result.gold;

    const dropChance = isBoss ? 1 : (0.10 + stage * 0.02);
    if(Math.random() < dropChance){
      result.item = addItem(createItem(isBoss ? "rare" : rollDropRarity(stage)));
    }
    hero.dungeon.stage = isBoss ? 1 : stage + 1;
  } else {
    hero.dungeon.stage = 1;
  }
  return result;
}

let fightLog = [];
let lastResult = null;

function pushLog(result){
  fightLog.unshift(result);
  fightLog = fightLog.slice(0, 5);
  lastResult = result;
}

function describeResult(result){
  if(!result) return "Le donjon t'attend…";
  const where = result.isBoss ? "Boss" : "Palier " + result.stage;
  if(!result.won){
    return "💀 " + where + " — échec, retour au palier 1";
  }
  return "✅ " + where + " franchi · +" + result.essence + " essence · +" + result.gold + " or" +
    (result.item ? " · 🎁 " + itemDisplayName(result.item) : "");
}

// Rattrapage du temps écoulé (chargement de page ou retour sur l'onglet).
function catchUpDungeon(){
  const dungeon = state.hero.dungeon;
  const elapsed = Date.now() - dungeon.lastTick;
  const ticks = Math.floor(elapsed / (DUNGEON_TICK_SECONDS * 1000));
  if(ticks <= 0) return;

  const attempts = Math.min(ticks, MAX_OFFLINE_TICKS);
  const summary = { cleared: 0, essence: 0, gold: 0, items: 0 };
  for(let i = 0; i < attempts; i++){
    const result = resolveDungeonAttempt();
    pushLog(result);
    if(result.won){
      summary.cleared += 1;
      summary.essence += result.essence;
      summary.gold += result.gold;
      if(result.item){ summary.items += 1; }
    }
  }
  dungeon.lastTick = Date.now();
  saveHero();

  showToast("Pendant ton absence : " + summary.cleared + " palier" + (summary.cleared > 1 ? "s" : "") +
    " franchi" + (summary.cleared > 1 ? "s" : "") + ", +" + summary.essence + " essence, +" +
    summary.gold + " or, " + summary.items + " objet" + (summary.items > 1 ? "s" : "") + " trouvé" +
    (summary.items > 1 ? "s" : ""));
}

/* ================= SPRITE DU HÉROS ================= */
// Flipbook : on remplace la source de l'image frame par frame, une seule
// passe, puis retour à la pose au repos.
let attackFrameTimer = null;
let spriteBroken = false;
let framesPreloaded = false;

function heroAttackFrameSrc(index){
  return "assets/hero/attack/hero-attack-" + String(index).padStart(2, "0") + ".png";
}

function preloadAttackFrames(){
  // Chargées à la première ouverture de l'onglet seulement : inutile de
  // télécharger les frames pour quelqu'un qui n'ouvre jamais Mon Héros.
  if(framesPreloaded || spriteBroken) return;
  framesPreloaded = true;
  for(let i = 1; i <= HERO_ATTACK_FRAME_COUNT; i++){
    const img = new Image();
    img.src = heroAttackFrameSrc(i);
  }
}

function stopHeroAttack(){
  if(attackFrameTimer){
    clearInterval(attackFrameTimer);
    attackFrameTimer = null;
  }
}

function playHeroAttack(){
  const img = document.getElementById("heroSprite");
  if(!img || spriteBroken) return;
  stopHeroAttack();

  let frame = 1;
  img.src = heroAttackFrameSrc(frame);
  attackFrameTimer = setInterval(function(){
    frame += 1;
    if(frame > HERO_ATTACK_FRAME_COUNT){
      stopHeroAttack();
      img.src = HERO_IDLE_SRC;
      return;
    }
    img.src = heroAttackFrameSrc(frame);
  }, HERO_ATTACK_FRAME_MS);
}

// Chemin cassé ou image absente : on retombe sur la silhouette SVG plutôt
// que d'afficher une icône brisée.
document.getElementById("heroSprite").addEventListener("error", function(){
  spriteBroken = true;
  stopHeroAttack();
  this.hidden = true;
  // SVGElement n'hérite pas de HTMLElement : « .hidden = false » ne ferait que
  // poser une propriété JS sans retirer l'attribut, il faut passer par le DOM.
  document.getElementById("heroSpriteFallback").removeAttribute("hidden");
});

let animating = false;

function runLiveTick(){
  const result = resolveDungeonAttempt();
  state.hero.dungeon.lastTick = Date.now();
  pushLog(result);
  saveHero();
  animateFight(result);
}

function animateFight(result){
  animating = true;
  playHeroAttack(); // 12 frames x 80 ms = 960 ms, terminé avant le résultat
  const fill = document.getElementById("dungeonHpFill");
  fill.style.transition = "none";
  fill.style.width = "100%";
  void fill.offsetWidth; // force le reflow pour repartir de 100 %
  fill.style.transition = "width 1s ease";
  fill.style.width = result.won ? "0%" : "45%";
  document.getElementById("dungeonResult").textContent = "Assaut en cours…";

  setTimeout(function(){
    animating = false;
    renderHero();
    if(result.item){
      showToast("🎁 " + itemDisplayName(result.item) + " (" + RARITY_LABELS[result.item.rarity] + ")");
    }
  }, 1100);
}

// Horloge unique : anime un combat quand l'onglet est visible, sinon laisse
// le temps s'accumuler pour le rattrapage au retour.
setInterval(function(){
  if(state.activeView !== "hero" || document.hidden || animating) return;
  const remaining = DUNGEON_TICK_SECONDS * 1000 - (Date.now() - state.hero.dungeon.lastTick);
  if(remaining <= 0){
    runLiveTick();
  } else {
    const el = document.getElementById("dungeonNext");
    if(el){ el.textContent = "Prochain assaut dans " + Math.ceil(remaining / 1000) + " s"; }
  }
}, 1000);

/* ================= PROGRESSION DEPUIS LES SÉANCES ================= */
// Appelé par workout.js à la finalisation d'une séance : seule source d'XP,
// donc seule source de gemmes.
function onWorkoutCompleted(session, options){
  const opts = options || {};
  const hero = state.hero;

  let setCount = 0;
  session.exercises.forEach(function(ex){ setCount += ex.sets.length; });
  if(setCount === 0) return;

  let gained = setCount * 2;
  if(opts.hasPR){ gained += 15; }
  hero.xp += gained;

  let levelsGained = 0;
  let gemsGained = 0;
  while(hero.xp >= xpForNextLevel(hero.level)){
    hero.xp -= xpForNextLevel(hero.level);
    hero.level += 1;
    hero.stats.force += 1;
    hero.stats.endurance += 1;
    hero.stats.vitesse += 1;
    hero.gems += 1;
    gemsGained += 1;
    if(hero.level % 5 === 0){
      hero.gems += 3;
      gemsGained += 3;
    }
    levelsGained += 1;
  }

  saveHero();
  renderHero();

  const parts = [];
  if(opts.prMessage){ parts.push(opts.prMessage); }
  parts.push("⚔️ +" + gained + " XP");
  if(levelsGained > 0){
    parts.push("⭐ Niveau " + hero.level + " · +" + gemsGained + " 💎");
  }
  showToast(parts.join("  ·  "));
}

/* ================= RENDU ================= */
function renderHero(){
  renderHeroCharacter();
  renderDungeon();
  renderUpgrades();
  renderTreasure();
  renderEquipment();
  renderHeroShop();
  renderHeroInventory();
}

function renderHeroCharacter(){
  const hero = state.hero;
  const nameInput = document.getElementById("heroName");
  if(document.activeElement !== nameInput){ nameInput.value = hero.name; }

  document.getElementById("heroLevel").textContent = "Niveau " + hero.level;

  const needed = xpForNextLevel(hero.level);
  document.getElementById("heroXpText").textContent = hero.xp + " / " + needed + " XP";
  document.getElementById("heroXpFill").style.width = Math.min(100, (hero.xp / needed) * 100) + "%";

  const total = totalStats();
  const base = baseStats();
  ["force","endurance","vitesse"].forEach(function(stat){
    const extra = total[stat] - base[stat];
    document.getElementById("heroStat-" + stat).innerHTML =
      fmtStat(total[stat]) +
      (extra > 0 ? ' <span class="hero-stat-bonus">+' + fmtStat(extra) + '</span>' : "");
  });

  document.getElementById("heroPower").textContent = fmtStat(totalPower());
  document.getElementById("heroGold").textContent = hero.gold;
  document.getElementById("heroEssence").textContent = hero.dungeon.essence;
  document.getElementById("heroGems").textContent = hero.gems;
}

function renderDungeon(){
  const dungeon = state.hero.dungeon;
  const isBoss = dungeon.stage === DUNGEON_MAX_STAGE;

  document.getElementById("dungeonStage").textContent = isBoss
    ? "⚔️ BOSS"
    : "Palier " + dungeon.stage + "/" + DUNGEON_MAX_STAGE;
  document.getElementById("dungeonOdds").textContent =
    Math.round(winProbability(dungeon.stage) * 100) + " % de réussite";

  // Pendant l'animation, la barre est pilotée par animateFight().
  if(!animating){
    const fill = document.getElementById("dungeonHpFill");
    fill.style.transition = "none";
    fill.style.width = "100%";
  }

  document.getElementById("dungeonResult").textContent = describeResult(lastResult);

  const log = document.getElementById("dungeonLog");
  log.innerHTML = fightLog.length === 0
    ? ""
    : fightLog.map(function(r){
        return '<div class="dungeon-log-line' + (r.won ? "" : " is-fail") + '">' +
          escapeHtml(describeResult(r)) + "</div>";
      }).join("");
}

function upgradeCost(stat){
  return Math.round(10 * Math.pow(1.5, state.hero.essenceUpgrades[stat]));
}

function renderUpgrades(){
  const essence = state.hero.dungeon.essence;
  ["force","endurance","vitesse"].forEach(function(stat){
    const cost = upgradeCost(stat);
    const btn = document.getElementById("upgrade-" + stat);
    btn.disabled = essence < cost;
    btn.querySelector(".upgrade-cost").textContent = "✨ " + cost;
  });
}

function renderTreasure(){
  const gems = state.hero.gems;
  document.getElementById("legendaryChestBtn").disabled = gems < LEGENDARY_CHEST_GEMS;

  const select = document.getElementById("forgeSelect");
  const inventory = state.hero.inventory;
  const previous = select.value;
  if(inventory.length === 0){
    select.innerHTML = '<option value="">Aucun objet à forger</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = inventory.map(function(item){
      return '<option value="' + item.id + '">' + escapeHtml(itemDisplayName(item)) +
        " — " + SLOT_LABELS[item.slot] + "</option>";
    }).join("");
    if(inventory.some(function(i){ return i.id === previous; })){ select.value = previous; }
  }
  document.getElementById("forgeBtn").disabled = gems < FORGE_GEMS || inventory.length === 0;
}

function renderEquipment(){
  const hero = state.hero;
  document.getElementById("equipmentGrid").innerHTML = EQUIPMENT_SLOTS.map(function(slot){
    const item = findItem(hero.equipment[slot]);
    return '<button class="equip-slot' + (item ? " is-filled" : "") + '" data-goto-slot="' + slot + '">' +
      '<span class="equip-slot-icon">' + SLOT_ICONS[slot] + "</span>" +
      '<span class="equip-slot-label">' + SLOT_LABELS[slot] + "</span>" +
      '<span class="equip-slot-item">' + (item ? escapeHtml(itemDisplayName(item)) : "vide") + "</span>" +
      "</button>";
  }).join("");
}

function renderHeroShop(){
  const gold = state.hero.gold;
  document.getElementById("chestCommonBtn").disabled = gold < CHEST_COMMON_PRICE;
  document.getElementById("chestRareBtn").disabled = gold < CHEST_RARE_PRICE;
}

function renderHeroInventory(){
  const el = document.getElementById("heroInventory");
  const hero = state.hero;
  if(hero.inventory.length === 0){
    el.innerHTML = '<p class="empty-state">Aucun objet. Le donjon et les coffres t\'en fourniront.</p>';
    return;
  }

  el.innerHTML = EQUIPMENT_SLOTS.map(function(slot){
    const items = hero.inventory.filter(function(item){ return item.slot === slot; });
    if(items.length === 0) return "";
    return '<div class="inv-group" id="inv-' + slot + '">' +
      '<div class="inv-group-title">' + SLOT_ICONS[slot] + " " + SLOT_LABELS[slot] + "</div>" +
      items.map(function(item){
        const equipped = hero.equipment[slot] === item.id;
        return '<div class="weapon-item">' +
          '<div class="weapon-info">' +
          '<div class="weapon-name">' + escapeHtml(itemDisplayName(item)) +
          ' <span class="weapon-rarity is-' + item.rarity + '">' + RARITY_LABELS[item.rarity] + "</span></div>" +
          '<div class="weapon-bonus">' + escapeHtml(bonusLabel(item.bonus)) + "</div>" +
          "</div>" +
          (equipped
            ? '<button class="btn-secondary weapon-equip is-unequip" data-unequip="' + slot + '">Retirer</button>'
            : '<button class="btn-secondary weapon-equip" data-equip="' + item.id + '">Équiper</button>') +
          "</div>";
      }).join("") +
      "</div>";
  }).join("");
}

/* ================= AMÉLIORATIONS À L'ESSENCE ================= */
["force","endurance","vitesse"].forEach(function(stat){
  document.getElementById("upgrade-" + stat).addEventListener("click", function(){
    const cost = upgradeCost(stat);
    if(state.hero.dungeon.essence < cost) return;
    state.hero.dungeon.essence -= cost;
    state.hero.essenceUpgrades[stat] += 1;
    saveHero();
    renderHero();
    showToast("✨ " + stat + " +0,5 (" + fmtStat(baseStats()[stat]) + " de base)");
  });
});

/* ================= TRÉSOR (GEMMES) ================= */
document.getElementById("legendaryChestBtn").addEventListener("click", function(){
  const hero = state.hero;
  if(hero.gems < LEGENDARY_CHEST_GEMS) return;
  hero.gems -= LEGENDARY_CHEST_GEMS;
  const item = addItem(createItem("legendary"));
  saveHero();
  renderHero();
  showToast("🌟 Légendaire : " + item.name + " (" + bonusLabel(item.bonus) + ")");
});

document.getElementById("forgeBtn").addEventListener("click", function(){
  const hero = state.hero;
  const item = findItem(document.getElementById("forgeSelect").value);
  if(!item || hero.gems < FORGE_GEMS) return;
  hero.gems -= FORGE_GEMS;
  Object.keys(item.bonus).forEach(function(stat){ item.bonus[stat] += 1; });
  item.upgradeCount += 1;
  saveHero();
  renderHero();
  showToast("🔨 " + itemDisplayName(item) + " (" + bonusLabel(item.bonus) + ")");
});

/* ================= BOUTIQUE (OR) ================= */
function openChest(rarity){
  const hero = state.hero;
  const price = rarity === "rare" ? CHEST_RARE_PRICE : CHEST_COMMON_PRICE;
  if(hero.gold < price){
    showToast("Il te manque " + (price - hero.gold) + " or.");
    return;
  }
  hero.gold -= price;
  const item = addItem(createItem(rarity));
  saveHero();
  renderHero();
  showToast("🎁 " + item.name + " — " + SLOT_LABELS[item.slot] + " (" + bonusLabel(item.bonus) + ")");
}

document.getElementById("chestCommonBtn").addEventListener("click", function(){ openChest("common"); });
document.getElementById("chestRareBtn").addEventListener("click", function(){ openChest("rare"); });

/* ================= ÉQUIPEMENT ET INVENTAIRE ================= */
document.getElementById("heroInventory").addEventListener("click", function(e){
  const equip = e.target.closest("[data-equip]");
  if(equip){
    const item = findItem(equip.dataset.equip);
    if(!item) return;
    state.hero.equipment[item.slot] = item.id; // un seul objet actif par emplacement
    saveHero();
    renderHero();
    return;
  }
  const unequip = e.target.closest("[data-unequip]");
  if(unequip){
    state.hero.equipment[unequip.dataset.unequip] = null;
    saveHero();
    renderHero();
  }
});

document.getElementById("equipmentGrid").addEventListener("click", function(e){
  const btn = e.target.closest("[data-goto-slot]");
  if(!btn) return;
  const group = document.getElementById("inv-" + btn.dataset.gotoSlot);
  const target = group || document.querySelector(".hero-inventory-card");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("heroName").addEventListener("input", function(e){
  state.hero.name = e.target.value;
  saveHero();
});
document.getElementById("heroName").addEventListener("blur", function(e){
  if(!e.target.value.trim()){
    state.hero.name = "Héros";
    saveHero();
    renderHeroCharacter();
  }
});

// L'entrée dans l'onglet crédite d'abord le temps écoulé, puis affiche.
function showHeroView(){
  preloadAttackFrames();
  catchUpDungeon();
  renderHero();
}

registerView("hero", showHeroView);
