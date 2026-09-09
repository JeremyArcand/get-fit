"use strict";

/* ================================================================
   ONGLET MON HÉROS — progression RPG alimentée uniquement par les
   séances réellement loggées : aucune XP, aucun or et aucune attaque
   ne peut être gagné en dehors de workout.js.
   ================================================================ */

const MONSTER_NAMES = [
  "Gobelin poussif", "Loup des landes", "Golem de pierre", "Spectre affamé",
  "Ogre bedonnant", "Basilic endormi", "Chevalier déchu", "Hydre à deux têtes",
  "Démon de la fonte", "Dragon d'acier"
];

// Butin commun : bonus modestes, une ou deux stats.
const LOOT_COMMON = [
  { name: "Dague rouillée",     bonus: { force: 1 } },
  { name: "Gourdin de chêne",   bonus: { force: 2 } },
  { name: "Bâton du marcheur",  bonus: { endurance: 2 } },
  { name: "Sandales lestées",   bonus: { vitesse: 2 } },
  { name: "Hachette de camp",   bonus: { force: 2, vitesse: 1 } },
  { name: "Bouclier de bois",   bonus: { endurance: 3 } }
];

// Butin rare : bonus plus forts, parfois sur les trois stats.
const LOOT_RARE = [
  { name: "Lame de l'aurore",     bonus: { force: 5, vitesse: 3 } },
  { name: "Marteau du colosse",   bonus: { force: 6, endurance: 3 } },
  { name: "Égide runique",        bonus: { endurance: 6, force: 3 } },
  { name: "Griffes du vent",      bonus: { vitesse: 6, force: 3 } },
  { name: "Relique du champion",  bonus: { force: 4, endurance: 4, vitesse: 4 } }
];

const CHEST_COMMON_PRICE = 25;
const CHEST_RARE_PRICE = 60;

function xpForNextLevel(level){
  return 50 * level;
}

function makeMonster(index){
  const tier = Math.floor(index / MONSTER_NAMES.length);
  const base = MONSTER_NAMES[index % MONSTER_NAMES.length];
  const maxHp = Math.round(40 * Math.pow(1.2, index));
  return {
    name: tier > 0 ? base + " " + "★".repeat(tier) : base,
    maxHp: maxHp,
    hp: maxHp,
    goldReward: 8 + index * 2
  };
}

// Le monstre courant peut manquer (nouvel utilisateur ou sauvegarde ancienne).
if(!state.hero.currentMonster){
  state.hero.currentMonster = makeMonster(state.hero.monsterIndex);
  saveHero();
}

function equippedWeapon(){
  if(!state.hero.equippedWeaponId) return null;
  return state.hero.inventory.find(function(w){ return w.id === state.hero.equippedWeaponId; }) || null;
}

// Stats de base + bonus de l'arme équipée.
function totalStats(){
  const base = state.hero.stats;
  const weapon = equippedWeapon();
  const bonus = weapon ? weapon.bonus : {};
  return {
    force: base.force + (bonus.force || 0),
    endurance: base.endurance + (bonus.endurance || 0),
    vitesse: base.vitesse + (bonus.vitesse || 0)
  };
}

function attackDamage(){
  return 3 + Math.round(totalStats().force / 2);
}

function bonusLabel(bonus){
  return Object.keys(bonus).map(function(k){
    return "+" + bonus[k] + " " + k;
  }).join(" · ");
}

/* ================= PROGRESSION DEPUIS LES SÉANCES ================= */
// Appelé par workout.js à la finalisation d'une séance — seule source
// possible de XP, de charges d'attaque et donc d'or.
function onWorkoutCompleted(session, options){
  const opts = options || {};
  const hero = state.hero;

  let setCount = 0;
  session.exercises.forEach(function(ex){ setCount += ex.sets.length; });
  if(setCount === 0) return;

  let gained = setCount * 2;
  if(opts.hasPR){ gained += 15; }

  hero.xp += gained;
  hero.attackCharges += setCount;

  const levelsGained = [];
  while(hero.xp >= xpForNextLevel(hero.level)){
    hero.xp -= xpForNextLevel(hero.level);
    hero.level += 1;
    hero.stats.force += 1;
    hero.stats.endurance += 1;
    hero.stats.vitesse += 1;
    levelsGained.push(hero.level);
  }

  saveHero();
  renderHero();

  const parts = [];
  if(opts.prMessage){ parts.push(opts.prMessage); }
  parts.push("⚔️ +" + gained + " XP · +" + setCount + " attaque" + (setCount > 1 ? "s" : ""));
  if(levelsGained.length > 0){
    parts.push("⭐ Niveau " + hero.level + " !");
  }
  showToast(parts.join("  ·  "));
}

/* ================= RENDU ================= */
function renderHero(){
  renderHeroCharacter();
  renderHeroCombat();
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

  const stats = totalStats();
  const base = hero.stats;
  ["force","endurance","vitesse"].forEach(function(key){
    const extra = stats[key] - base[key];
    document.getElementById("heroStat-" + key).innerHTML =
      stats[key] + (extra > 0 ? ' <span class="hero-stat-bonus">+' + extra + '</span>' : "");
  });

  document.getElementById("heroGold").textContent = hero.gold;
}

function renderHeroCombat(){
  const hero = state.hero;
  const monster = hero.currentMonster;

  document.getElementById("monsterName").textContent = monster.name;
  document.getElementById("monsterHpText").textContent = monster.hp + " / " + monster.maxHp + " PV";
  document.getElementById("monsterHpFill").style.width = Math.max(0, (monster.hp / monster.maxHp) * 100) + "%";
  document.getElementById("monsterReward").textContent = "🪙 " + monster.goldReward + " en butin";

  const btn = document.getElementById("attackBtn");
  const hasCharges = hero.attackCharges > 0;
  btn.disabled = !hasCharges;
  btn.textContent = hasCharges
    ? "Attaquer (" + attackDamage() + " dégâts)"
    : "Aucune attaque disponible";

  document.getElementById("attackHint").textContent = hasCharges
    ? hero.attackCharges + " attaque" + (hero.attackCharges > 1 ? "s" : "") + " en réserve"
    : "Entraîne-toi pour recharger tes attaques";
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
    el.innerHTML = '<p class="empty-state">Aucune arme. Ouvre un coffre pour en trouver une.</p>';
    return;
  }
  el.innerHTML = hero.inventory.map(function(w){
    const equipped = w.id === hero.equippedWeaponId;
    return '<div class="weapon-item">' +
      '<div class="weapon-info">' +
      '<div class="weapon-name">' + escapeHtml(w.name) +
      ' <span class="weapon-rarity ' + (w.rarity === "rare" ? "is-rare" : "is-common") + '">' +
      (w.rarity === "rare" ? "rare" : "commune") + '</span></div>' +
      '<div class="weapon-bonus">' + escapeHtml(bonusLabel(w.bonus)) + '</div>' +
      '</div>' +
      (equipped
        ? '<span class="weapon-equipped">Équipée</span>'
        : '<button class="btn-secondary weapon-equip" data-equip="' + w.id + '">Équiper</button>') +
      '</div>';
  }).join("");
}

/* ================= COMBAT ================= */
document.getElementById("attackBtn").addEventListener("click", function(){
  const hero = state.hero;
  if(hero.attackCharges <= 0) return;

  hero.attackCharges -= 1;
  hero.currentMonster.hp -= attackDamage();

  let message = "";
  if(hero.currentMonster.hp <= 0){
    const reward = hero.currentMonster.goldReward;
    const beaten = hero.currentMonster.name;
    hero.gold += reward;
    hero.monsterIndex += 1;
    hero.currentMonster = makeMonster(hero.monsterIndex);
    message = "🏅 " + beaten + " vaincu ! +" + reward + " or";
  }

  saveHero();
  renderHero();
  if(message){ showToast(message); }
});

/* ================= BOUTIQUE ================= */
function openChest(rarity){
  const hero = state.hero;
  const price = rarity === "rare" ? CHEST_RARE_PRICE : CHEST_COMMON_PRICE;
  if(hero.gold < price){
    showToast("Il te manque " + (price - hero.gold) + " or.");
    return;
  }
  const table = rarity === "rare" ? LOOT_RARE : LOOT_COMMON;
  const pick = table[Math.floor(Math.random() * table.length)];

  hero.gold -= price;
  const weapon = { id: nextId(), name: pick.name, bonus: pick.bonus, rarity: rarity };
  hero.inventory.push(weapon);

  // Première arme trouvée : on l'équipe directement.
  if(!hero.equippedWeaponId){ hero.equippedWeaponId = weapon.id; }

  saveHero();
  renderHero();
  showToast("🎁 " + weapon.name + " (" + bonusLabel(weapon.bonus) + ")");
}

document.getElementById("chestCommonBtn").addEventListener("click", function(){ openChest("common"); });
document.getElementById("chestRareBtn").addEventListener("click", function(){ openChest("rare"); });

/* ================= INVENTAIRE ================= */
document.getElementById("heroInventory").addEventListener("click", function(e){
  const btn = e.target.closest("[data-equip]");
  if(!btn) return;
  state.hero.equippedWeaponId = btn.dataset.equip;
  saveHero();
  renderHero();
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

registerView("hero", renderHero);
