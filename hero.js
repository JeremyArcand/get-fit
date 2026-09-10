"use strict";

/* ================================================================
   ONGLET MON HÉROS — Phase 2.

   Deux économies distinctes :
   - Essence et or : farmables via le donjon automatique, qui tourne
     tout seul avec le temps (et rattrape le temps hors-ligne).
   - Gemmes : uniquement via une montée de niveau, donc uniquement
     via une vraie séance loggée dans workout.js.
   ================================================================ */

/* ================================================================
   SYSTÈME "MON HÉROS" (refonte) — ÉTAPE 1

   Constantes issues du classeur de balance et fonctions de calcul
   pures : aucune ne touche au DOM ni au localStorage, elles prennent
   un état et retournent une valeur.

   Ce bloc ne remplace pas encore le donjon actuel plus bas dans le
   fichier ; rien ne l'appelle pour l'instant.
   ================================================================ */

const CONFIG = {
  xp: {
    baseSeance: 50,
    diviseurVolume: 200,
    bonusPR: 25,
    courbeCoeff: 50,
    courbeExposant: 1.5,
    softCap: 25,
    incrementApresCap: 200,
    niveauMax: 50
  },

  stats: {
    pvBase: 100,      pvParNiveau: 35,
    atqBase: 10,      atqParNiveau: 6,
    defBase: 5,       defParNiveau: 2.5,
    critBase: 0.05,   critGainMax: 0.15,  critK: 20,
    critMult: 1.75,
    armureK: 80
  },

  nutrition: {
    toleranceCalories: 0.10,   // ±10 % de la cible
    seuilProteines: 0.90,      // ≥ 90 % de la cible
    seuilEau: 0.90,
    bonusCalories: 0.05,       // indépendant — s'ajoute si cette cible précise est atteinte
    bonusProteines: 0.08,      // le plus élevé : cohérent avec un style riche en protéines
    bonusEau: 0.04,
    bonusSerieParJour: 0.01,   // par jour PARFAIT consécutif (les 3 cibles le même jour)
    bonusSerieMax: 0.15,       // plafond à 15 jours de série
    chanceParJourStreak: 2,    // même compteur de série que le bonus XP
    chanceMax: 30
  },

  moral: {
    max: 100,
    seance: 8,
    seanceManquee: -10,        // SEULE source de pénalité. La nutrition n'affecte jamais le moral.
    multMin: 0.85,
    seuilPlein: 80
  },

  streak: {
    objectifSeancesSemaine: 4,
    bonusParSemaine: 0.02,
    bonusMax: 0.20
  },

  donjon: {
    paliers: 10,
    regenEntrePaliers: 0.25,
    ennemiPvBase: 50,   ennemiPvExposant: 0.90,
    ennemiAtqBase: 10,  ennemiAtqExposant: 0.80,
    ennemiDefBase: 4,   ennemiDefExposant: 0.85,
    croissanceParCycle: 0.20,
    bossMultPv: 2.2,
    bossMultAtq: 1.5,
    toursMax: 200               // garde-fou anti-boucle infinie
  },

  economie: {
    orParPalier: 10,
    bonusOrParCycle: 0.10,
    essenceParPalier: 1,
    essenceBoss: 5,
    coutCoffre: 3000,
    coutAmeliorationEssence: 40,
    facteurCoutEssence: 1.35,
    gemmesBaseParNiveau: 3,
    gemmesBonusPar5Niveaux: 1
  },

  loot: {
    tauxDrop: 0.10,
    poids: { commun: 70, rare: 22, ultraRare: 6.5, mythique: 1.4, legendaire: 0.1 },
    effetChance: 0.01,
    pityDouxDebut: 40,
    pityDouxIncrement: 0.03,
    pityDur: 60
  },

  equipement: {
    puissanceBase: 6,
    puissanceParPalier: 4,
    multRarete: { commun: 1.00, rare: 1.60, ultraRare: 2.60, mythique: 4.20, legendaire: 6.80 },
    gainParForge: 0.08,
    forgeMax: 10,
    coutForgeBase: 5,
    facteurCoutForge: 1.22
  },

  fusion: {
    objetsRequis: 3,
    chanceSautDoubleParPoint: 0.005,
    coutOrBase: 200,
    facteurCoutOr: 3
  },

  vente: { coefficientPrix: 1.5 },

  descentes: {
    parJour: 1,
    bonusParSeance: 1,
    maxAccumulees: 5
  }
};

const RARETES = ['commun', 'rare', 'ultraRare', 'mythique', 'legendaire'];
const SLOTS   = ['arme', 'casque', 'plastron', 'jambieres', 'bague', 'collier'];

// Chaque objet a une puissance unique ; le slot décide de ce qu'elle devient.
const PROFILS_SLOT = {
  arme:      { atq: 0.85, crit: 0.00010 },
  casque:    { pv: 1.40,  def: 0.08 },
  plastron:  { pv: 2.20,  def: 0.17 },
  jambieres: { pv: 1.20,  def: 0.25 },
  bague:     { atq: 0.15, crit: 0.00025 },
  collier:   { chance: 0.10, bonusXP: 0.0004 }
};

const BONUS_XP_COLLIER_MAX = 0.15;

/* ---------------- Courbe d'XP ---------------- */
function xpRequisPourNiveau(niveau) {
  if (niveau <= 1) return 0;
  const L = niveau - 1;
  const { courbeCoeff: c, courbeExposant: e, softCap, incrementApresCap } = CONFIG.xp;
  return L <= softCap
    ? Math.round(c * Math.pow(L, e))
    : Math.round(c * Math.pow(softCap, e) + incrementApresCap * (L - softCap));
}

// XP cumulée nécessaire pour atteindre chaque niveau, calculée une seule
// fois : niveauDepuisXP() est appelée à chaque rendu.
function construireTableXP() {
  const table = [0];
  let cumul = 0;
  for (let n = 1; n <= CONFIG.xp.niveauMax; n++) {
    cumul += xpRequisPourNiveau(n);
    table[n] = cumul;
  }
  return table;
}
const TABLE_XP = construireTableXP();

function niveauDepuisXP(xpTotal) {
  for (let n = CONFIG.xp.niveauMax; n >= 1; n--) {
    if (xpTotal >= TABLE_XP[n]) return n;
  }
  return 1;
}

/* ---------------- Stats effectives ---------------- */
function trouverObjet(etat, id) {
  if (!id || !etat.inventaire) return null;
  return etat.inventaire.find(function (o) { return o.id === id; }) || null;
}

function puissanceObjet(o) {
  const e = CONFIG.equipement;
  return (e.puissanceBase + e.puissanceParPalier * o.palier)
       * e.multRarete[o.rarete]
       * Math.pow(1 + CONFIG.donjon.croissanceParCycle, o.cycle - 1)
       * (1 + e.gainParForge * o.forge);
}

// Points de Chance gagnés par la série de jours de nutrition réussis.
function chanceDepuisNutrition(etat) {
  const n = CONFIG.nutrition;
  const jours = (etat.compteurs && etat.compteurs.streakNutritionJours) || 0;
  return Math.min(jours * n.chanceParJourStreak, n.chanceMax);
}

function calculerStats(etat) {
  const niveau = niveauDepuisXP(etat.xpTotal);
  const s = CONFIG.stats;

  const stats = {
    niveau: niveau,
    pv:     s.pvBase  + s.pvParNiveau  * (niveau - 1),
    atq:    s.atqBase + s.atqParNiveau * (niveau - 1),
    def:    s.defBase + s.defParNiveau * (niveau - 1),
    crit:   s.critBase + s.critGainMax * (niveau / (niveau + s.critK)),
    chance: 0,
    bonusXP: 0
  };

  const equipe = etat.equipe || {};
  for (const slot of SLOTS) {
    const objet = trouverObjet(etat, equipe[slot]);
    if (!objet) continue;
    const p = puissanceObjet(objet);
    for (const [stat, coeff] of Object.entries(PROFILS_SLOT[slot])) {
      stats[stat] += p * coeff;
    }
  }

  stats.chance += chanceDepuisNutrition(etat);
  // Sans ce plafond, le collier finirait par écraser l'apport de la nutrition.
  stats.bonusXP = Math.min(stats.bonusXP, BONUS_XP_COLLIER_MAX);
  return stats;
}

/* ---------------- Moral ---------------- */
function multiplicateurMoral(moral) {
  const { multMin, seuilPlein } = CONFIG.moral;
  return multMin + (1 - multMin) * Math.min(moral, seuilPlein) / seuilPlein;
}

function ajusterMoral(etat, delta) {
  etat.moral = Math.max(0, Math.min(CONFIG.moral.max, etat.moral + delta));
}

/* ---------------- Nutrition : bonus pur, jamais de pénalité ---------------- */
// Trois cibles indépendantes. Aucune ne peut faire descendre le multiplicateur
// sous 1,00. Rien loggé retourne null, et non un objet rempli de false : ce
// null court-circuite tout calcul de bonus.
function evaluerJourNutrition(totaux, cibles) {
  if (totaux === null || totaux === undefined) return null;

  const n = CONFIG.nutrition;
  const calOk  = Math.abs(totaux.calories - cibles.calories) <= cibles.calories * n.toleranceCalories;
  const protOk = totaux.proteines >= cibles.proteines * n.seuilProteines;
  const eauOk  = totaux.eau >= cibles.eau * n.seuilEau;
  const nbCibles = [calOk, protOk, eauOk].filter(Boolean).length;

  const bonusJour = (calOk ? n.bonusCalories : 0)
                  + (protOk ? n.bonusProteines : 0)
                  + (eauOk ? n.bonusEau : 0);

  return { calOk, protOk, eauOk, nbCibles, compteSerie: nbCibles >= 2, bonusJour };
}

// Un jour compte pour la série dès 2 cibles sur 3. En dessous — ou non loggé —
// la série retombe à zéro, sans jamais faire passer le multiplicateur sous 1.
function mettreAJourSerieNutrition(etat, evalJour) {
  if (evalJour === null) {
    etat.compteurs.streakNutritionJours = 0;
    return;
  }
  etat.compteurs.streakNutritionJours = evalJour.compteSerie
    ? etat.compteurs.streakNutritionJours + 1
    : 0;
}

function bonusSerieNutrition(etat) {
  const n = CONFIG.nutrition;
  return Math.min(etat.compteurs.streakNutritionJours * n.bonusSerieParJour, n.bonusSerieMax);
}

function multiplicateurNutritionDuJour(etat, evalJour) {
  if (evalJour === null || evalJour === undefined) return 1;   // neutre, aucun calcul
  return 1 + evalJour.bonusJour + bonusSerieNutrition(etat);
}

/* ---------------- XP d'une séance ---------------- */
function bonusXPCollier(etat) {
  return calculerStats(etat).bonusXP;   // déjà plafonné à 0,15
}

function calculerXPSeance(seance, etat, evalNutritionDuJour) {
  const { baseSeance, diviseurVolume, bonusPR } = CONFIG.xp;

  const volume = seance.exercices.reduce((t, ex) =>
    t + ex.series.reduce((s, serie) => s + serie.poids * serie.reps, 0), 0);

  const brut = baseSeance + volume / diviseurVolume + seance.nbPR * bonusPR;

  const multNutrition = multiplicateurNutritionDuJour(etat, evalNutritionDuJour);
  const multMoral  = multiplicateurMoral(etat.moral);
  const multStreak = Math.min(
    1 + CONFIG.streak.bonusParSemaine * etat.compteurs.streakSemaines,
    1 + CONFIG.streak.bonusMax
  );
  const multCollier = 1 + bonusXPCollier(etat);

  return {
    brut: Math.round(brut),
    final: Math.round(brut * multNutrition * multMoral * multStreak * multCollier),
    detail: { volume, multNutrition, multMoral, multStreak, multCollier }
  };
}

// Gemmes accordées en atteignant un niveau (colonne « Gemmes gagnées » du classeur).
function gemmesPourNiveau(niveau) {
  const e = CONFIG.economie;
  return e.gemmesBaseParNiveau + Math.floor(niveau / 5) * e.gemmesBonusPar5Niveaux;
}

/* ---------------- État du nouveau système ---------------- */
const CLE_SAUVEGARDE = 'getfit_hero_v1';

function etatInitialHero() {
  return {
    version: 1,
    xpTotal: 0,
    moral: CONFIG.moral.max,
    or: 0,
    essence: 0,
    gemmes: 0,
    ameliorationsEssence: 0,
    equipe: { arme: null, casque: null, plastron: null, jambieres: null, bague: null, collier: null },
    inventaire: [],
    donjon: { cycle: 1, palierAtteint: 0, descentesDisponibles: 1, derniereDescente: null },
    compteurs: {
      pityLegendaire: 0,
      streakSemaines: 0,
      streakNutritionJours: 0,
      seancesSemaineCourante: 0,
      semaineCourante: null,
      dernierJourNutritionEvalue: null
    },
    journal: []
  };
}

// Chaque changement de structure ajoutera un bloc ici, jamais une réécriture.
function migrerEtatHero(etat) {
  if (!etat.version) etat.version = 1;
  if (!etat.compteurs) etat.compteurs = etatInitialHero().compteurs;
  if (etat.compteurs.dernierJourNutritionEvalue === undefined) {
    etat.compteurs.dernierJourNutritionEvalue = null;
  }
  return etat;
}

function chargerEtatHero() {
  let brut = null;
  try { brut = localStorage.getItem(CLE_SAUVEGARDE); } catch (e) { brut = null; }
  if (!brut) return etatInitialHero();
  try {
    return migrerEtatHero(JSON.parse(brut));
  } catch (e) {
    return etatInitialHero();
  }
}

function sauvegarderEtatHero(etat) {
  try { localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify(etat)); } catch (e) {}
}

let etatHero = chargerEtatHero();

/* ---------------- Point d'entrée appelé par workout.js ---------------- */
// Retourne le gain complet (et pas juste un nombre) : l'interface a besoin du
// niveau avant/après, des gemmes et du détail des multiplicateurs.
function gagnerXP(seance, evalNutritionDuJour) {
  const evalJour = evalNutritionDuJour === undefined ? null : evalNutritionDuJour;
  const niveauAvant = niveauDepuisXP(etatHero.xpTotal);

  const gain = calculerXPSeance(seance, etatHero, evalJour);
  etatHero.xpTotal += gain.final;

  const niveauApres = niveauDepuisXP(etatHero.xpTotal);
  let gemmesGagnees = 0;
  for (let n = niveauAvant + 1; n <= niveauApres; n++) gemmesGagnees += gemmesPourNiveau(n);
  etatHero.gemmes += gemmesGagnees;

  sauvegarderEtatHero(etatHero);

  return {
    brut: gain.brut,
    final: gain.final,
    detail: gain.detail,
    niveauAvant: niveauAvant,
    niveauApres: niveauApres,
    gemmesGagnees: gemmesGagnees
  };
}

function ajusterMoralHero(delta) {
  ajusterMoral(etatHero, delta);
  sauvegarderEtatHero(etatHero);
  return etatHero.moral;
}

// Clôture d'une journée de nutrition. `totaux` à null = rien loggé ce jour-là :
// strictement neutre, ni moral ni série touchés. Un jour loggé mais raté coûte
// du moral — c'est toute la différence entre optionnel et obligatoire.
// `iso` sert à avancer le marqueur pour qu'un jour ne soit jamais évalué deux fois.
function evaluerJourNutrition(totaux, cibles, iso) {
  const c = etatHero.compteurs;
  if (iso) c.dernierJourNutritionEvalue = iso;

  if (totaux === null || totaux === undefined) {
    sauvegarderEtatHero(etatHero);
    return null;
  }

  const score = calculerScoreNutrition(totaux, cibles);
  if (score >= CONFIG.nutrition.seuilReussite) {
    ajusterMoral(etatHero, CONFIG.moral.jourNutritionReussi);
    c.streakNutritionJours += 1;
  } else {
    ajusterMoral(etatHero, CONFIG.moral.jourNutritionRate);
    c.streakNutritionJours = 0;
  }
  sauvegarderEtatHero(etatHero);
  return score;
}

// Façade nommée comme les points d'intégration de la spec.
const HERO = {
  gagnerXP: gagnerXP,
  ajusterMoral: ajusterMoralHero,
  evaluerJourNutrition: evaluerJourNutrition,
  dernierJourNutritionEvalue: function () { return etatHero.compteurs.dernierJourNutritionEvalue; },
  marquerJourNutritionEvalue: function (iso) {
    etatHero.compteurs.dernierJourNutritionEvalue = iso;
    sauvegarderEtatHero(etatHero);
  },
  etat: function () { return etatHero; },
  stats: function () { return calculerStats(etatHero); }
};

/* ================================================================
   SYSTÈME DE DONJON ACTUEL (Phases 1 à 3) — inchangé pour l'instant
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

/* ================= DONJON — COMBAT CONTINU ================= */
// Les PV du monstre servent d'échelle de difficulté : plus le palier est
// haut, plus il faut de secondes d'attaque pour l'abattre.
function stageDifficulty(stage){
  const base = 15 * Math.pow(1.35, stage);
  return stage === DUNGEON_MAX_STAGE ? base * 1.5 : base;
}

function monsterMaxHp(stage){
  return Math.round(stageDifficulty(stage));
}

function makeMonster(stage){
  const entry = MONSTER_ROSTER[(stage - 1) % MONSTER_ROSTER.length];
  const maxHp = monsterMaxHp(stage);
  return { name: entry.name, icon: entry.icon, stage: stage, maxHp: maxHp, hp: maxHp };
}

// Dégâts fixes par attaque. La force totale (équipement compris) compte pour
// moitié, et l'arme ajoute son bonus de force en entier.
function attackDamage(){
  const weapon = findItem(state.hero.equipment.weapon);
  const weaponForce = weapon && weapon.bonus.force ? weapon.bonus.force : 0;
  return 3 + Math.floor(totalStats().force / 2) + weaponForce;
}

function isBossStage(){
  return state.hero.dungeon.stage === DUNGEON_MAX_STAGE;
}

// Remet un monstre cohérent en place si la sauvegarde n'en avait pas.
function ensureMonster(){
  const d = state.hero.dungeon;
  const m = d.currentMonster;
  if(!m || m.stage !== d.stage || !(m.maxHp > 0) || !(m.hp > 0)){
    d.currentMonster = makeMonster(d.stage);
    return true;
  }
  return false;
}

function rollDropRarity(stage){
  // Plus le palier est haut, plus le butin penche vers "rare".
  const rareChance = Math.min(0.6, 0.05 + stage * 0.06);
  return Math.random() < rareChance ? "rare" : "common";
}

// Récompenses d'un monstre abattu, puis passage au monstre suivant.
// Utilisé en direct comme en rattrapage hors-ligne.
function grantKillRewards(isBoss){
  const d = state.hero.dungeon;
  const stage = d.stage;
  const multiplier = isBoss ? 3 : 1;
  const essence = (2 + stage) * multiplier;
  const gold = (3 + stage * 2) * multiplier;

  d.essence += essence;
  state.hero.gold += gold;

  let item = null;
  const dropChance = isBoss ? 1 : (0.10 + stage * 0.02);
  if(Math.random() < dropChance){
    item = addItem(createItem(isBoss ? "rare" : rollDropRarity(stage)));
  }

  if(isBoss){
    d.run += 1;
    d.stage = 1;
    d.bossFightActive = false;
    d.bossTimeRemaining = 0;
  } else {
    d.stage = stage + 1;
    if(d.stage === DUNGEON_MAX_STAGE){
      // Le boss ne démarre jamais tout seul : il attend le clic du joueur.
      d.bossFightActive = false;
      d.bossTimeRemaining = BOSS_TIME_LIMIT_SECONDS;
    }
  }
  d.currentMonster = makeMonster(d.stage);
  return { stage: stage, isBoss: isBoss, essence: essence, gold: gold, item: item };
}

let fightLog = [];
let lastResult = null;

function pushLog(entry){
  fightLog.unshift(entry);
  fightLog = fightLog.slice(0, 5);
  lastResult = entry;
}

function describeResult(entry){
  if(!entry) return "Le donjon t'attend…";
  if(entry.text) return entry.text;
  const where = entry.isBoss ? "Boss" : "Palier " + entry.stage;
  return "✅ " + where + " vaincu · +" + entry.essence + " essence · +" + entry.gold + " or" +
    (entry.item ? " · 🎁 " + itemDisplayName(entry.item) : "");
}

// Rattrapage du temps écoulé. Ne résout jamais un combat de boss : le joueur
// doit être présent pour voir le minuteur tourner.
function catchUpDungeon(){
  const d = state.hero.dungeon;
  const elapsedSeconds = Math.floor((Date.now() - d.lastTick) / 1000);
  d.lastTick = Date.now();
  if(elapsedSeconds <= 0) return;

  const seconds = Math.min(elapsedSeconds, MAX_OFFLINE_SECONDS);
  const attacks = Math.floor(seconds / DUNGEON_TICK_SECONDS);
  if(attacks <= 0 || isBossStage()) { saveHero(); return; }

  const summary = { cleared: 0, essence: 0, gold: 0, items: 0, reachedBoss: false };
  const damage = attackDamage();

  for(let i = 0; i < attacks; i++){
    if(isBossStage()){ summary.reachedBoss = true; break; }
    d.currentMonster.hp -= damage;
    if(d.currentMonster.hp <= 0){
      const reward = grantKillRewards(false);
      pushLog(reward);
      summary.cleared += 1;
      summary.essence += reward.essence;
      summary.gold += reward.gold;
      if(reward.item){ summary.items += 1; }
    }
  }
  saveHero();

  if(summary.cleared === 0 && !summary.reachedBoss) return;
  showToast("Pendant ton absence : " + summary.cleared + " palier" + (summary.cleared > 1 ? "s" : "") +
    " franchi" + (summary.cleared > 1 ? "s" : "") + ", +" + summary.essence + " essence, +" +
    summary.gold + " or, " + summary.items + " objet" + (summary.items > 1 ? "s" : "") + " trouvé" +
    (summary.items > 1 ? "s" : "") + (summary.reachedBoss ? " · le boss t'attend !" : ""));
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

/* ================= EFFETS DE COMBAT ================= */
function spawnFx(html, className, lifeMs){
  const layer = document.getElementById("monsterFx");
  if(!layer) return;
  const el = document.createElement("span");
  el.className = className;
  el.innerHTML = html;
  layer.appendChild(el);
  setTimeout(function(){ el.remove(); }, lifeMs);
}

function showHitEffects(damage){
  const figure = document.getElementById("monsterFigure");
  if(figure){
    figure.classList.remove("is-hit");
    void figure.offsetWidth; // relance l'animation même sur des coups rapprochés
    figure.classList.add("is-hit");
  }
  // Décalage horizontal aléatoire pour que les nombres ne se superposent pas.
  const offset = Math.round((Math.random() - 0.5) * 40);
  spawnFx("-" + damage, "fx-damage", 900);
  const last = document.querySelector("#monsterFx .fx-damage:last-child");
  if(last){ last.style.setProperty("--fx-x", offset + "px"); }
}

function playDeathParticles(){
  for(let i = 0; i < 8; i++){
    const angle = (Math.PI * 2 * i) / 8;
    spawnFx("", "fx-particle", 700);
    const particle = document.querySelector("#monsterFx .fx-particle:last-child");
    if(particle){
      particle.style.setProperty("--px", Math.round(Math.cos(angle) * 46) + "px");
      particle.style.setProperty("--py", Math.round(Math.sin(angle) * 46) + "px");
    }
  }
}

/* ================= BOUCLE DE COMBAT ================= */
let heroSaveTimer = null;
function saveHeroSoon(){
  // Une écriture localStorage par seconde serait inutilement coûteuse.
  if(heroSaveTimer) return;
  heroSaveTimer = setTimeout(function(){
    heroSaveTimer = null;
    saveHero();
  }, 3000);
}

function failBoss(){
  const d = state.hero.dungeon;
  d.bossFightActive = false;
  d.bossTimeRemaining = 0;
  d.stage = 1;
  d.currentMonster = makeMonster(1);
  pushLog({ text: "⏳ Boss non vaincu à temps — retour au palier 1", fail: true });
  saveHero();
  renderDungeon();
  showToast("⏳ Temps écoulé ! Le boss t'échappe. Retour au palier 1, tes gains sont conservés.");
}

function performTick(){
  const d = state.hero.dungeon;
  ensureMonster();

  // Le boss attend explicitement que le joueur lance le combat.
  if(isBossStage() && !d.bossFightActive){
    renderDungeon();
    return;
  }

  if(isBossStage()){
    d.bossTimeRemaining -= DUNGEON_TICK_SECONDS;
    if(d.bossTimeRemaining <= 0){
      failBoss();
      return;
    }
  }

  const damage = attackDamage();
  d.currentMonster.hp -= damage;
  playHeroAttack();
  showHitEffects(damage);

  if(d.currentMonster.hp <= 0){
    const wasBoss = isBossStage();
    playDeathParticles();
    const reward = grantKillRewards(wasBoss);
    pushLog(reward);
    saveHero();
    renderHero();
    if(wasBoss){
      showToast("🏅 Boss vaincu ! Run " + d.run + " · +" + reward.essence + " essence · +" + reward.gold + " or");
    } else if(reward.item){
      showToast("🎁 " + itemDisplayName(reward.item) + " (" + RARITY_LABELS[reward.item.rarity] + ")");
    }
    return;
  }

  saveHeroSoon();
  renderDungeon();
}

// Une attaque par tick tant que l'onglet est visible ; sinon le temps
// s'accumule et sera rattrapé au retour.
setInterval(function(){
  if(state.activeView !== "hero" || document.hidden) return;
  state.hero.dungeon.lastTick = Date.now();
  performTick();
}, DUNGEON_TICK_SECONDS * 1000);

document.getElementById("bossStartBtn").addEventListener("click", function(){
  const d = state.hero.dungeon;
  if(!isBossStage() || d.bossFightActive) return;
  d.bossFightActive = true;
  d.bossTimeRemaining = BOSS_TIME_LIMIT_SECONDS;
  d.lastTick = Date.now();
  saveHero();
  renderDungeon();
});

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

function fmtClock(totalSeconds){
  const s = Math.max(0, Math.ceil(totalSeconds));
  return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}

function renderDungeon(){
  const d = state.hero.dungeon;
  const isBoss = isBossStage();
  ensureMonster();
  const monster = d.currentMonster;

  document.getElementById("dungeonRun").textContent =
    "Run " + d.run + " · " + (isBoss ? "⚔️ BOSS" : "Palier " + d.stage + "/" + DUNGEON_MAX_STAGE);
  document.getElementById("dungeonDps").textContent = attackDamage() + " dégâts / attaque";

  document.getElementById("monsterEmoji").textContent = monster.icon;
  document.getElementById("monsterName").textContent = monster.name;
  document.getElementById("monsterHpText").textContent =
    Math.max(0, Math.ceil(monster.hp)) + " / " + monster.maxHp + " PV";
  document.getElementById("dungeonHpFill").style.width =
    Math.max(0, (monster.hp / monster.maxHp) * 100) + "%";

  // Bannière de boss : avant le clic, puis minuteur pendant le combat.
  const banner = document.getElementById("bossBanner");
  const startBtn = document.getElementById("bossStartBtn");
  const timer = document.getElementById("bossTimer");
  if(isBoss){
    banner.hidden = false;
    if(d.bossFightActive){
      startBtn.hidden = true;
      timer.hidden = false;
      timer.textContent = fmtClock(d.bossTimeRemaining);
      timer.classList.toggle("is-urgent", d.bossTimeRemaining <= 10);
    } else {
      startBtn.hidden = false;
      timer.hidden = true;
    }
  } else {
    banner.hidden = true;
  }

  document.getElementById("dungeonResult").textContent = describeResult(lastResult);

  const log = document.getElementById("dungeonLog");
  log.innerHTML = fightLog.map(function(entry){
    return '<div class="dungeon-log-line' + (entry.fail ? " is-fail" : "") + '">' +
      escapeHtml(describeResult(entry)) + "</div>";
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

// Une sauvegarde d'avant le combat continu n'a pas de monstre : on en pose un.
if(ensureMonster()){ saveHero(); }

registerView("hero", showHeroView);
