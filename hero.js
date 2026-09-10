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
    // +1 ATQ permanent par amélioration achetée à l'essence (boutique).
    atq:    s.atqBase + s.atqParNiveau * (niveau - 1) + (etat.ameliorationsEssence || 0),
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
    nom: "Héros",
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
// Défensif : une sauvegarde d'avant la refonte donjon/équipement n'a aucun
// de ces champs, il faut les compléter sans jamais écraser ce qui existe.
function migrerEtatHero(etat) {
  const defaut = etatInitialHero();
  if (!etat.version) etat.version = 1;
  if (typeof etat.or !== "number") etat.or = defaut.or;
  if (typeof etat.essence !== "number") etat.essence = defaut.essence;
  if (typeof etat.gemmes !== "number") etat.gemmes = defaut.gemmes;
  if (typeof etat.ameliorationsEssence !== "number") etat.ameliorationsEssence = defaut.ameliorationsEssence;
  if (typeof etat.moral !== "number") etat.moral = defaut.moral;
  if (typeof etat.nom !== "string" || !etat.nom.trim()) etat.nom = defaut.nom;

  if (!etat.equipe || typeof etat.equipe !== "object") etat.equipe = {};
  for (const slot of SLOTS) {
    if (!(slot in etat.equipe)) etat.equipe[slot] = null;
  }

  if (!Array.isArray(etat.inventaire)) etat.inventaire = [];
  if (!Array.isArray(etat.journal)) etat.journal = [];

  if (!etat.donjon || typeof etat.donjon !== "object") etat.donjon = {};
  if (typeof etat.donjon.cycle !== "number") etat.donjon.cycle = defaut.donjon.cycle;
  if (typeof etat.donjon.palierAtteint !== "number") etat.donjon.palierAtteint = defaut.donjon.palierAtteint;
  if (typeof etat.donjon.descentesDisponibles !== "number") etat.donjon.descentesDisponibles = defaut.donjon.descentesDisponibles;
  if (etat.donjon.derniereDescente === undefined) etat.donjon.derniereDescente = defaut.donjon.derniereDescente;

  if (!etat.compteurs) etat.compteurs = {};
  if (typeof etat.compteurs.pityLegendaire !== "number") etat.compteurs.pityLegendaire = 0;
  if (typeof etat.compteurs.streakSemaines !== "number") etat.compteurs.streakSemaines = 0;
  if (typeof etat.compteurs.streakNutritionJours !== "number") etat.compteurs.streakNutritionJours = 0;
  if (typeof etat.compteurs.seancesSemaineCourante !== "number") etat.compteurs.seancesSemaineCourante = 0;
  if (etat.compteurs.semaineCourante === undefined) etat.compteurs.semaineCourante = null;
  if (etat.compteurs.dernierJourNutritionEvalue === undefined) etat.compteurs.dernierJourNutritionEvalue = null;

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

// Clôture d'une journée : met à jour la série et avance le marqueur pour qu'un
// jour ne soit jamais compté deux fois. Le moral n'est pas touché — la
// nutrition n'accorde que des bonus.
function cloturerJourNutrition(evalJour, iso) {
  mettreAJourSerieNutrition(etatHero, evalJour);
  if (iso) etatHero.compteurs.dernierJourNutritionEvalue = iso;
  sauvegarderEtatHero(etatHero);
  return etatHero.compteurs.streakNutritionJours;
}

// Façade nommée comme les points d'intégration de la spec.
const HERO = {
  gagnerXP: gagnerXP,
  ajusterMoral: ajusterMoralHero,
  evaluerJourNutrition: evaluerJourNutrition,          // pure : totaux, cibles -> eval ou null
  mettreAJourSerieNutrition: function (evalJour) {     // applique à l'état courant
    mettreAJourSerieNutrition(etatHero, evalJour);
    sauvegarderEtatHero(etatHero);
  },
  cloturerJourNutrition: cloturerJourNutrition,
  multiplicateurNutritionDuJour: function (evalJour) {
    return multiplicateurNutritionDuJour(etatHero, evalJour);
  },
  dernierJourNutritionEvalue: function () { return etatHero.compteurs.dernierJourNutritionEvalue; },
  marquerJourNutritionEvalue: function (iso) {
    etatHero.compteurs.dernierJourNutritionEvalue = iso;
    sauvegarderEtatHero(etatHero);
  },
  etat: function () { return etatHero; },
  stats: function () { return calculerStats(etatHero); },
  // Appelé par workout.js après chaque séance loggée : une descente de
  // donjon de plus, cumulable jusqu'au plafond.
  crediterDescente: function (n) {
    etatHero.donjon.descentesDisponibles = Math.min(
      CONFIG.descentes.maxAccumulees,
      etatHero.donjon.descentesDisponibles + n
    );
    sauvegarderEtatHero(etatHero);
  },
  // Utilisé par le code de sauvegarde/restauration de shared.js.
  remplacerEtat: function (nouvelEtat) {
    etatHero = migrerEtatHero(nouvelEtat);
    sauvegarderEtatHero(etatHero);
    if (typeof renderHero === "function") renderHero();
  }
};

/* ================================================================
   LOOT — tirage de rareté et génération d'objets (spec section 6).
   ================================================================ */
function tenterDrop(etat, palier, cycle, chance) {
  if (Math.random() >= CONFIG.loot.tauxDrop) return null;
  return genererObjetLoot(etat, palier, cycle, chance);
}

// Partagé par le loot du donjon et le coffre (achat garanti) : seul le test
// de taux de drop change entre les deux appelants.
function genererObjetLoot(etat, palier, cycle, chance) {
  etat.compteurs.pityLegendaire++;
  const rarete = tirerRarete(etat, chance);
  if (rarete === 'legendaire') etat.compteurs.pityLegendaire = 0;

  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
  return {
    id: 'obj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    slot: slot,
    rarete: rarete,
    palier: palier,
    cycle: cycle,
    forge: 0,
    nom: nomObjet(slot, rarete),
    obtenuLe: todayISO()
  };
}

function tirerRarete(etat, chance) {
  const l = CONFIG.loot;
  const c = etat.compteurs.pityLegendaire;

  if (c >= l.pityDur) return 'legendaire';

  const bonusPity = Math.max(0, c - l.pityDouxDebut) * l.pityDouxIncrement;
  if (bonusPity > 0 && Math.random() < bonusPity) return 'legendaire';

  const poids = RARETES.map(function (r, i) { return l.poids[r] * (1 + chance * l.effetChance * i); });
  const total = poids.reduce(function (a, b) { return a + b; }, 0);
  let tirage = Math.random() * total;
  for (let i = 0; i < RARETES.length; i++) {
    tirage -= poids[i];
    if (tirage <= 0) return RARETES[i];
  }
  return 'commun';
}

/* ================================================================
   FUSION ET VENTE (spec section 7).
   ================================================================ */
function estEquipe(etat, id) {
  return SLOTS.some(function (slot) { return etat.equipe[slot] === id; });
}

function coutFusion(rarete) {
  const i = RARETES.indexOf(rarete);
  return Math.round(CONFIG.fusion.coutOrBase * Math.pow(CONFIG.fusion.facteurCoutOr, i));
}

function fusionner(etat, idsObjets) {
  const objets = idsObjets.map(function (id) { return trouverObjet(etat, id); });
  if (objets.some(function (o) { return !o; })) throw new Error('Objet introuvable');
  const slot = objets[0].slot;
  const rarete = objets[0].rarete;

  if (objets.length !== CONFIG.fusion.objetsRequis) throw new Error('Il faut 3 objets');
  if (!objets.every(function (o) { return o.slot === slot && o.rarete === rarete; })) {
    throw new Error('Emplacement ou rareté différents');
  }
  if (rarete === 'legendaire') throw new Error('Rareté maximale atteinte');
  if (etat.or < coutFusion(rarete)) throw new Error('Or insuffisant');

  const chance = calculerStats(etat).chance;
  const sautDouble = Math.random() < chance * CONFIG.fusion.chanceSautDoubleParPoint;
  const rang = RARETES.indexOf(rarete);
  const nouveauRang = Math.min(rang + (sautDouble ? 2 : 1), RARETES.length - 1);

  etat.or -= coutFusion(rarete);
  etat.inventaire = etat.inventaire.filter(function (o) { return idsObjets.indexOf(o.id) === -1; });

  const resultat = {
    id: 'obj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    slot: slot,
    rarete: RARETES[nouveauRang],
    palier: Math.max.apply(null, objets.map(function (o) { return o.palier; })),
    cycle: Math.max.apply(null, objets.map(function (o) { return o.cycle; })),
    forge: 0,
    nom: nomObjet(slot, RARETES[nouveauRang]),
    obtenuLe: todayISO()
  };
  etat.inventaire.push(resultat);
  return { objet: resultat, sautDouble: sautDouble };
}

function prixVente(objet) {
  return Math.round(puissanceObjet(objet) * CONFIG.vente.coefficientPrix);
}

function vendreObjet(etat, id) {
  if (estEquipe(etat, id)) throw new Error("Retire l'objet avant de le vendre");
  const objet = trouverObjet(etat, id);
  if (!objet) throw new Error('Objet introuvable');
  const prix = prixVente(objet);
  etat.or += prix;
  etat.inventaire = etat.inventaire.filter(function (o) { return o.id !== id; });
  return { objet: objet, prix: prix };
}

/* ================================================================
   FORGE — améliore un objet (CONFIG.equipement), 0 à forgeMax.
   ================================================================ */
function coutForge(objet) {
  const e = CONFIG.equipement;
  return Math.round(e.coutForgeBase * Math.pow(e.facteurCoutForge, objet.forge));
}

function forger(etat, id) {
  const objet = trouverObjet(etat, id);
  if (!objet) throw new Error('Objet introuvable');
  if (objet.forge >= CONFIG.equipement.forgeMax) throw new Error('Forge déjà au maximum');
  const cout = coutForge(objet);
  if (etat.gemmes < cout) throw new Error('Gemmes insuffisantes');
  etat.gemmes -= cout;
  objet.forge += 1;
  return objet;
}

/* ================================================================
   COFFRE (OR) — complète les drops, ne les remplace pas.
   ================================================================ */
function ouvrirCoffre(etat) {
  const cout = CONFIG.economie.coutCoffre;
  if (etat.or < cout) throw new Error('Or insuffisant');
  etat.or -= cout;
  const chance = calculerStats(etat).chance;
  // Toujours au palier maximal : un achat n'est jamais plus faible qu'un
  // drop de fin de cycle.
  const objet = genererObjetLoot(etat, CONFIG.donjon.paliers, etat.donjon.cycle, chance);
  etat.inventaire.push(objet);
  return objet;
}

/* ================================================================
   AMÉLIORATIONS À L'ESSENCE — +1 ATQ permanent, coût escaladant.
   ================================================================ */
function coutAmeliorationEssence(etat) {
  const e = CONFIG.economie;
  return Math.round(e.coutAmeliorationEssence * Math.pow(e.facteurCoutEssence, etat.ameliorationsEssence));
}

function ameliorerEssence(etat) {
  const cout = coutAmeliorationEssence(etat);
  if (etat.essence < cout) throw new Error('Essence insuffisante');
  etat.essence -= cout;
  etat.ameliorationsEssence += 1;
  return etat.ameliorationsEssence;
}

/* ================================================================
   DESCENTES — une par jour + une par séance loggée, cumulables (spec 5).
   ================================================================ */
function joursEcoules(iso1, iso2) {
  if (!iso1) return 0;
  return Math.round((fromISO(iso2) - fromISO(iso1)) / 86400000);
}

// Crédit quotidien passif : appelé une fois à l'ouverture de l'onglet.
function crediterDescentesQuotidiennes(etat, aujourdhui) {
  if (!etat.donjon.derniereDescente) {
    etat.donjon.derniereDescente = aujourdhui;
    return;
  }
  const jours = joursEcoules(etat.donjon.derniereDescente, aujourdhui);
  if (jours > 0) {
    etat.donjon.descentesDisponibles = Math.min(
      CONFIG.descentes.maxAccumulees,
      etat.donjon.descentesDisponibles + jours * CONFIG.descentes.parJour
    );
    etat.donjon.derniereDescente = aujourdhui;
  }
}

/* ================================================================
   RÉSOLUTION D'UNE DESCENTE — déterministe sauf le loot (spec section 5).
   Calcule les 10 paliers d'un coup ; chaque palier porte assez de détail
   (ennemi, tours, dégâts, PV avant/après) pour être rejoué visuellement
   palier par palier, coup par coup, par le moteur d'animation plus bas.
   ================================================================ */
function resoudreDescente(etat) {
  const stats = calculerStats(etat);
  const d = CONFIG.donjon;
  const cycle = etat.donjon.cycle;
  const croissance = Math.pow(1 + d.croissanceParCycle, cycle - 1);

  let pv = stats.pv;
  const resultat = {
    paliers: [], reussie: false, or: 0, essence: 0, loot: [],
    pvMax: Math.round(stats.pv), cycleDepart: cycle
  };

  for (let palier = 1; palier <= d.paliers; palier++) {
    const boss = palier === d.paliers;

    const ennemi = {
      pv: Math.round(d.ennemiPvBase * Math.pow(palier, d.ennemiPvExposant) * croissance * (boss ? d.bossMultPv : 1)),
      atq: Math.round(d.ennemiAtqBase * Math.pow(palier, d.ennemiAtqExposant) * croissance * (boss ? d.bossMultAtq : 1)),
      def: Math.round(d.ennemiDefBase * Math.pow(palier, d.ennemiDefExposant) * croissance)
    };

    const degatsInfliges = Math.max(1, stats.atq * (1 - ennemi.def / (ennemi.def + CONFIG.stats.armureK)));
    const dps = degatsInfliges * (1 + stats.crit * (CONFIG.stats.critMult - 1));
    const tours = Math.min(Math.ceil(ennemi.pv / dps), d.toursMax);
    const subis = Math.max(1, ennemi.atq * (1 - stats.def / (stats.def + CONFIG.stats.armureK)));

    // Régénération AVANT le combat du palier, jamais après (sinon le boss
    // profite d'une régénération qu'il n'a pas méritée).
    if (palier > 1) pv = Math.min(stats.pv, pv + stats.pv * d.regenEntrePaliers);
    const pvAvant = pv;
    // Le joueur frappe en premier : il n'encaisse que (tours - 1) ripostes.
    pv -= subis * Math.max(0, tours - 1);

    const identite = boss ? bossPourCycle(cycle) : monstrePourPalier(cycle, palier);
    const palierInfo = {
      palier: palier, boss: boss, ennemi: ennemi, tours: tours,
      degats: Math.round(dps), subis: Math.round(subis),
      pvJoueurAvant: Math.round(pvAvant), monstre: identite
    };

    if (pv <= 0) {
      palierInfo.reussi = false;
      palierInfo.pvJoueurApres = 0;
      resultat.paliers.push(palierInfo);
      break;
    }

    palierInfo.reussi = true;
    palierInfo.pvJoueurApres = Math.round(pv);
    resultat.paliers.push(palierInfo);

    resultat.or += Math.round(CONFIG.economie.orParPalier * palier * (1 + CONFIG.economie.bonusOrParCycle * (cycle - 1)));
    resultat.essence += CONFIG.economie.essenceParPalier + (boss ? CONFIG.economie.essenceBoss : 0);

    const objet = tenterDrop(etat, palier, cycle, stats.chance);
    if (objet) { resultat.loot.push(objet); palierInfo.objet = objet; }

    if (boss) resultat.reussie = true;
  }
  return resultat;
}

// Un échec ne coûte jamais les ressources déjà gagnées avant la chute.
function appliquerDescente(etat, resultat) {
  etat.or += resultat.or;
  etat.essence += resultat.essence;
  resultat.loot.forEach(function (o) { etat.inventaire.push(o); });
  etat.donjon.descentesDisponibles = Math.max(0, etat.donjon.descentesDisponibles - 1);

  if (resultat.reussie) {
    etat.donjon.cycle += 1;
    etat.donjon.palierAtteint = 0;
  } else {
    etat.donjon.palierAtteint = 0;
  }
}

/* ================================================================
   HABILLAGE — libellés et icônes d'affichage.
   ================================================================ */
const SLOT_LABELS = { arme: "Arme", casque: "Casque", plastron: "Plastron", jambieres: "Jambières", bague: "Bague", collier: "Collier" };
const SLOT_ICONS = { arme: "🗡️", casque: "🪖", plastron: "🛡️", jambieres: "👖", bague: "💍", collier: "📿" };
const RARITY_LABELS = { commun: "commune", rare: "rare", ultraRare: "ultra-rare", mythique: "mythique", legendaire: "légendaire" };

function fmtStat(v) {
  return String(Math.round(v * 10) / 10).replace(".", ",");
}

function itemDisplayName(o) {
  return o.forge > 0 ? o.nom + " +" + o.forge : o.nom;
}

/* ================================================================
   SPRITE DU HÉROS — flipbook d'attaque (repris tel quel de l'ancien
   système, rien à changer ici : les sprites ne bougent pas).
   ================================================================ */
const DUNGEON_TICK_SECONDS = 1;
const HERO_ATTACK_FRAME_COUNT = 12;
const HERO_ATTACK_FRAME_MS = 80;
const HERO_IDLE_SRC = "assets/hero/hero-idle.png";

let attackFrameTimer = null;
let spriteBroken = false;
let framesPreloaded = false;

function heroAttackFrameSrc(index) {
  return "assets/hero/attack/hero-attack-" + String(index).padStart(2, "0") + ".png";
}

function preloadAttackFrames() {
  if (framesPreloaded || spriteBroken) return;
  framesPreloaded = true;
  for (let i = 1; i <= HERO_ATTACK_FRAME_COUNT; i++) {
    const img = new Image();
    img.src = heroAttackFrameSrc(i);
  }
}

function stopHeroAttack() {
  if (attackFrameTimer) {
    clearInterval(attackFrameTimer);
    attackFrameTimer = null;
  }
}

function playHeroAttack() {
  const img = document.getElementById("heroSprite");
  if (!img || spriteBroken) return;
  stopHeroAttack();

  let frame = 1;
  img.src = heroAttackFrameSrc(frame);
  attackFrameTimer = setInterval(function () {
    frame += 1;
    if (frame > HERO_ATTACK_FRAME_COUNT) {
      stopHeroAttack();
      img.src = HERO_IDLE_SRC;
      return;
    }
    img.src = heroAttackFrameSrc(frame);
  }, HERO_ATTACK_FRAME_MS);
}

document.getElementById("heroSprite").addEventListener("error", function () {
  spriteBroken = true;
  stopHeroAttack();
  this.hidden = true;
  document.getElementById("heroSpriteFallback").removeAttribute("hidden");
});

/* ================================================================
   EFFETS DE COMBAT — repris tels quels.
   ================================================================ */
function spawnFx(html, className, lifeMs) {
  const layer = document.getElementById("monsterFx");
  if (!layer) return;
  const el = document.createElement("span");
  el.className = className;
  el.innerHTML = html;
  layer.appendChild(el);
  setTimeout(function () { el.remove(); }, lifeMs);
}

function showHitEffects(damage) {
  const figure = document.getElementById("monsterFigure");
  if (figure) {
    figure.classList.remove("is-hit");
    void figure.offsetWidth;
    figure.classList.add("is-hit");
  }
  const offset = Math.round((Math.random() - 0.5) * 40);
  spawnFx("-" + damage, "fx-damage", 900);
  const last = document.querySelector("#monsterFx .fx-damage:last-child");
  if (last) { last.style.setProperty("--fx-x", offset + "px"); }
}

function playDeathParticles() {
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    spawnFx("", "fx-particle", 700);
    const particle = document.querySelector("#monsterFx .fx-particle:last-child");
    if (particle) {
      particle.style.setProperty("--px", Math.round(Math.cos(angle) * 46) + "px");
      particle.style.setProperty("--py", Math.round(Math.sin(angle) * 46) + "px");
    }
  }
}

/* ================================================================
   MOTEUR D'ANIMATION — la descente est déjà entièrement résolue
   (resoudreDescente est déterministe) ; ce moteur ne fait que rejouer
   le résultat visuellement, palier par palier, coup par coup, au même
   rythme que l'ancien donjon temps réel.
   ================================================================ */
let animationEnCours = false;
let journalDescentes = [];
const etatVisuel = {
  monstreNom: "—", monstreIcone: "👺", monstrePv: 0, monstrePvMax: 0,
  joueurPv: 0, joueurPvMax: 0, texte: "Le donjon t'attend…"
};

function lancerDescente() {
  if (animationEnCours) return;
  if (etatHero.donjon.descentesDisponibles <= 0) {
    showToast("Aucune descente disponible : 1 par jour, +1 par séance loggée (max 5).");
    return;
  }
  const resultat = resoudreDescente(etatHero);
  appliquerDescente(etatHero, resultat);
  sauvegarderEtatHero(etatHero);
  animerDescente(resultat);
}

function animerDescente(resultat) {
  animationEnCours = true;
  preloadAttackFrames();
  etatVisuel.joueurPvMax = resultat.pvMax;
  renderHero();

  let i = 0;
  function paliersuivantOuFin(arreter) {
    if (arreter || i >= resultat.paliers.length) {
      terminerAnimation(resultat);
      return;
    }
    const p = resultat.paliers[i];
    i += 1;
    animerPalier(p, paliersuivantOuFin);
  }
  paliersuivantOuFin(false);
}

function animerPalier(p, suite) {
  etatVisuel.monstreNom = p.monstre.nom;
  etatVisuel.monstreIcone = p.monstre.icone;
  etatVisuel.monstrePvMax = p.ennemi.pv;
  etatVisuel.monstrePv = p.ennemi.pv;
  etatVisuel.joueurPv = p.pvJoueurAvant;
  etatVisuel.texte = (p.boss ? "⚔️ Boss — " : "Palier " + p.palier + "/10 — ") + p.monstre.nom;
  renderDonjon();

  let coup = 0;
  function prochainCoup() {
    coup += 1;
    playHeroAttack();
    etatVisuel.monstrePv = Math.max(0, p.ennemi.pv - p.degats * coup);
    showHitEffects(p.degats);

    // Le joueur frappe en premier : la première riposte arrive après le 2e coup.
    if (coup > 1) {
      etatVisuel.joueurPv = Math.max(0, p.pvJoueurAvant - p.subis * (coup - 1));
    }
    renderDonjon();

    if (!p.reussi && etatVisuel.joueurPv <= 0) {
      setTimeout(function () { suite(true); }, 500);
      return;
    }
    if (coup >= p.tours) {
      etatVisuel.monstrePv = 0;
      playDeathParticles();
      renderDonjon();
      setTimeout(function () { suite(false); }, 350);
      return;
    }
    setTimeout(prochainCoup, DUNGEON_TICK_SECONDS * 1000);
  }
  setTimeout(prochainCoup, DUNGEON_TICK_SECONDS * 1000);
}

function terminerAnimation(resultat) {
  animationEnCours = false;
  const dernier = resultat.paliers[resultat.paliers.length - 1];
  const texte = resultat.reussie
    ? "🏅 Cycle " + resultat.cycleDepart + " terminé ! +" + resultat.or + " or · +" + resultat.essence + " essence" +
      (resultat.loot.length ? " · 🎁 " + resultat.loot.length + " objet" + (resultat.loot.length > 1 ? "s" : "") : "")
    : "💀 Défaite au palier " + dernier.palier + "/10 · déjà acquis : +" + resultat.or + " or · +" + resultat.essence + " essence";
  journalDescentes.unshift({ texte: texte, echec: !resultat.reussie });
  journalDescentes = journalDescentes.slice(0, 5);
  etatVisuel.texte = texte;
  showToast(texte);
  renderHero();
}

/* ================================================================
   RENDU
   ================================================================ */
function renderHero() {
  renderHeroCharacter();
  renderDonjon();
  renderEquipement();
  renderInventaire();
  renderAmeliorations();
  renderTresor();
}

function renderHeroCharacter() {
  const nameInput = document.getElementById("heroName");
  if (document.activeElement !== nameInput) nameInput.value = etatHero.nom;

  const niveau = niveauDepuisXP(etatHero.xpTotal);
  document.getElementById("heroLevel").textContent =
    niveau >= CONFIG.xp.niveauMax ? "Niveau maximum" : "Niveau " + niveau;

  const xpDebut = TABLE_XP[niveau - 1] || 0;
  const xpFin = TABLE_XP[niveau] || xpDebut;
  const dansNiveau = etatHero.xpTotal - xpDebut;
  const requisNiveau = Math.max(1, xpFin - xpDebut);
  document.getElementById("heroXpText").textContent =
    niveau >= CONFIG.xp.niveauMax ? etatHero.xpTotal + " XP" : dansNiveau + " / " + requisNiveau + " XP";
  document.getElementById("heroXpFill").style.width =
    (niveau >= CONFIG.xp.niveauMax ? 100 : Math.min(100, (dansNiveau / requisNiveau) * 100)) + "%";

  const stats = calculerStats(etatHero);
  document.getElementById("heroStat-pv").textContent = Math.round(stats.pv);
  document.getElementById("heroStat-atq").textContent = fmtStat(stats.atq);
  document.getElementById("heroStat-def").textContent = fmtStat(stats.def);
  document.getElementById("heroStat-crit").textContent = fmtStat(stats.crit * 100) + "%";
  document.getElementById("heroStat-chance").textContent = fmtStat(stats.chance);

  document.getElementById("heroOr").textContent = etatHero.or;
  document.getElementById("heroEssence").textContent = etatHero.essence;
  document.getElementById("heroGems").textContent = etatHero.gemmes;

  const moralPct = Math.round((etatHero.moral / CONFIG.moral.max) * 100);
  document.getElementById("heroMoralFill").style.width = moralPct + "%";
  document.getElementById("heroMoralText").textContent = Math.round(etatHero.moral) + " / " + CONFIG.moral.max;
}

function renderDonjon() {
  const d = etatHero.donjon;
  document.getElementById("dungeonRun").textContent = "Cycle " + d.cycle + " — " + nomCycle(d.cycle);
  document.getElementById("dungeonDps").textContent = "Descentes : " + d.descentesDisponibles + " / " + CONFIG.descentes.maxAccumulees;

  document.getElementById("monsterEmoji").textContent = etatVisuel.monstreIcone;
  document.getElementById("monsterName").textContent = etatVisuel.monstreNom;
  document.getElementById("monsterHpText").textContent =
    etatVisuel.monstrePvMax > 0 ? Math.max(0, Math.ceil(etatVisuel.monstrePv)) + " / " + etatVisuel.monstrePvMax + " PV" : "—";
  document.getElementById("dungeonHpFill").style.width =
    (etatVisuel.monstrePvMax > 0 ? Math.max(0, (etatVisuel.monstrePv / etatVisuel.monstrePvMax) * 100) : 0) + "%";

  document.getElementById("heroHpText").textContent =
    etatVisuel.joueurPvMax > 0 ? Math.max(0, Math.ceil(etatVisuel.joueurPv)) + " / " + Math.round(etatVisuel.joueurPvMax) + " PV" : "—";
  document.getElementById("heroHpFill").style.width =
    (etatVisuel.joueurPvMax > 0 ? Math.max(0, (etatVisuel.joueurPv / etatVisuel.joueurPvMax) * 100) : 100) + "%";

  document.getElementById("dungeonResult").textContent = etatVisuel.texte;

  const btn = document.getElementById("descendreBtn");
  btn.disabled = animationEnCours || d.descentesDisponibles <= 0;
  btn.textContent = animationEnCours ? "Descente en cours…" : "Descendre";

  document.getElementById("dungeonLog").innerHTML = journalDescentes.map(function (l) {
    return '<div class="dungeon-log-line' + (l.echec ? " is-fail" : "") + '">' + escapeHtml(l.texte) + "</div>";
  }).join("");
}

function renderEquipement() {
  document.getElementById("equipmentGrid").innerHTML = SLOTS.map(function (slot) {
    const o = trouverObjet(etatHero, etatHero.equipe[slot]);
    return '<button class="equip-slot' + (o ? " is-filled" : "") + '" data-goto-slot="' + slot + '">' +
      '<span class="equip-slot-icon">' + SLOT_ICONS[slot] + "</span>" +
      '<span class="equip-slot-label">' + SLOT_LABELS[slot] + "</span>" +
      '<span class="equip-slot-item">' + (o ? escapeHtml(itemDisplayName(o)) : "vide") + "</span>" +
      "</button>";
  }).join("");
}

function renderInventaire() {
  const el = document.getElementById("heroInventory");
  const inv = etatHero.inventaire;
  if (inv.length === 0) {
    el.innerHTML = '<p class="empty-state">Aucun objet. Le donjon et le coffre t\'en fourniront.</p>';
    return;
  }
  el.innerHTML = SLOTS.map(function (slot) {
    const items = inv.filter(function (o) { return o.slot === slot; });
    if (items.length === 0) return "";

    const groupesRarete = {};
    items.forEach(function (o) { (groupesRarete[o.rarete] = groupesRarete[o.rarete] || []).push(o); });

    const fusionsHtml = RARETES.filter(function (r) { return r !== "legendaire"; }).map(function (r) {
      const dispo = (groupesRarete[r] || []).filter(function (o) { return !estEquipe(etatHero, o.id); });
      if (dispo.length < CONFIG.fusion.objetsRequis) return "";
      const cout = coutFusion(r);
      const suivante = RARETES[RARETES.indexOf(r) + 1];
      return '<button class="btn-secondary fusion-btn" data-fusion-slot="' + slot + '" data-fusion-rarete="' + r + '"' +
        (etatHero.or < cout ? " disabled" : "") + ">Fusionner 3× " + RARITY_LABELS[r] + " → " + RARITY_LABELS[suivante] +
        " (🪙 " + cout + ")</button>";
    }).join("");

    return '<div class="inv-group" id="inv-' + slot + '">' +
      '<div class="inv-group-title">' + SLOT_ICONS[slot] + " " + SLOT_LABELS[slot] + "</div>" +
      fusionsHtml +
      items.map(function (o) {
        const equipe = etatHero.equipe[slot] === o.id;
        return '<div class="weapon-item">' +
          '<div class="weapon-info">' +
          '<div class="weapon-name">' + escapeHtml(itemDisplayName(o)) +
          ' <span class="weapon-rarity is-' + o.rarete + '">' + RARITY_LABELS[o.rarete] + "</span></div>" +
          '<div class="weapon-bonus">Puissance ' + fmtStat(puissanceObjet(o)) + " · palier " + o.palier + " · cycle " + o.cycle + "</div>" +
          "</div>" +
          '<div class="weapon-actions">' +
          (equipe
            ? '<button class="btn-secondary weapon-equip is-unequip" data-unequip="' + slot + '">Retirer</button>'
            : '<button class="btn-secondary weapon-equip" data-equip="' + o.id + '">Équiper</button>' +
              '<button class="btn-secondary weapon-sell" data-vendre="' + o.id + '">Vendre 🪙 ' + prixVente(o) + "</button>") +
          "</div>" +
          "</div>";
      }).join("") +
      "</div>";
  }).join("");
}

function renderAmeliorations() {
  const btn = document.getElementById("upgradeAtqBtn");
  const cout = coutAmeliorationEssence(etatHero);
  btn.disabled = etatHero.essence < cout;
  btn.querySelector(".upgrade-cost").textContent = "✨ " + cout;
}

function renderTresor() {
  const select = document.getElementById("forgeSelect");
  const inv = etatHero.inventaire;
  const previous = select.value;
  if (inv.length === 0) {
    select.innerHTML = '<option value="">Aucun objet à forger</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = inv.map(function (o) {
      return '<option value="' + o.id + '">' + escapeHtml(itemDisplayName(o)) + " — " + SLOT_LABELS[o.slot] +
        " (forge " + o.forge + "/" + CONFIG.equipement.forgeMax + ")</option>";
    }).join("");
    if (inv.some(function (o) { return o.id === previous; })) select.value = previous;
  }
  const objetChoisi = trouverObjet(etatHero, select.value);
  const coutF = objetChoisi ? coutForge(objetChoisi) : 0;
  const forgeBtn = document.getElementById("forgeBtn");
  forgeBtn.disabled = !objetChoisi || objetChoisi.forge >= CONFIG.equipement.forgeMax || etatHero.gemmes < coutF;
  forgeBtn.textContent = "Forger 💎 " + (objetChoisi ? coutF : "—");

  const coffreBtn = document.getElementById("coffreBtn");
  coffreBtn.disabled = etatHero.or < CONFIG.economie.coutCoffre;
  coffreBtn.querySelector(".chest-price").textContent = "🪙 " + CONFIG.economie.coutCoffre + " or";
}

/* ================================================================
   INTERACTIONS
   ================================================================ */
document.getElementById("descendreBtn").addEventListener("click", lancerDescente);

document.getElementById("upgradeAtqBtn").addEventListener("click", function () {
  try {
    ameliorerEssence(etatHero);
    sauvegarderEtatHero(etatHero);
    renderHero();
    showToast("⚔️ +1 ATQ permanent");
  } catch (e) { showToast(e.message); }
});

document.getElementById("coffreBtn").addEventListener("click", function () {
  try {
    const objet = ouvrirCoffre(etatHero);
    sauvegarderEtatHero(etatHero);
    renderHero();
    showToast("🎁 " + objet.nom + " — " + SLOT_LABELS[objet.slot] + " (" + RARITY_LABELS[objet.rarete] + ")");
  } catch (e) { showToast(e.message); }
});

document.getElementById("forgeBtn").addEventListener("click", function () {
  const id = document.getElementById("forgeSelect").value;
  try {
    const objet = forger(etatHero, id);
    sauvegarderEtatHero(etatHero);
    renderHero();
    showToast("🔨 " + itemDisplayName(objet) + " renforcé");
  } catch (e) { showToast(e.message); }
});

document.getElementById("heroInventory").addEventListener("click", function (e) {
  const equip = e.target.closest("[data-equip]");
  if (equip) {
    const o = trouverObjet(etatHero, equip.dataset.equip);
    if (o) {
      etatHero.equipe[o.slot] = o.id; // un seul objet actif par emplacement
      sauvegarderEtatHero(etatHero);
      renderHero();
    }
    return;
  }

  const unequip = e.target.closest("[data-unequip]");
  if (unequip) {
    etatHero.equipe[unequip.dataset.unequip] = null;
    sauvegarderEtatHero(etatHero);
    renderHero();
    return;
  }

  const vendre = e.target.closest("[data-vendre]");
  if (vendre) {
    try {
      const res = vendreObjet(etatHero, vendre.dataset.vendre);
      sauvegarderEtatHero(etatHero);
      renderHero();
      showToast("🪙 " + itemDisplayName(res.objet) + " vendu pour " + res.prix + " or");
    } catch (err) { showToast(err.message); }
    return;
  }

  const fusion = e.target.closest("[data-fusion-slot]");
  if (fusion) {
    const slot = fusion.dataset.fusionSlot;
    const rarete = fusion.dataset.fusionRarete;
    const candidats = etatHero.inventaire
      .filter(function (o) { return o.slot === slot && o.rarete === rarete && !estEquipe(etatHero, o.id); })
      .slice(0, CONFIG.fusion.objetsRequis)
      .map(function (o) { return o.id; });
    try {
      const res = fusionner(etatHero, candidats);
      sauvegarderEtatHero(etatHero);
      renderHero();
      showToast((res.sautDouble ? "✨✨ Fusion exceptionnelle : " : "✨ Fusion réussie : ") + itemDisplayName(res.objet));
    } catch (err) { showToast(err.message); }
  }
});

document.getElementById("equipmentGrid").addEventListener("click", function (e) {
  const btn = e.target.closest("[data-goto-slot]");
  if (!btn) return;
  const group = document.getElementById("inv-" + btn.dataset.gotoSlot);
  const target = group || document.querySelector(".hero-inventory-card");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("heroName").addEventListener("input", function (e) {
  etatHero.nom = e.target.value;
  sauvegarderEtatHero(etatHero);
});
document.getElementById("heroName").addEventListener("blur", function (e) {
  if (!e.target.value.trim()) {
    etatHero.nom = "Héros";
    sauvegarderEtatHero(etatHero);
    renderHeroCharacter();
  }
});

/* ================================================================
   ENTRÉE DANS L'ONGLET
   ================================================================ */
function showHeroView() {
  crediterDescentesQuotidiennes(etatHero, todayISO());
  sauvegarderEtatHero(etatHero);
  renderHero();
}

registerView("hero", showHeroView);
