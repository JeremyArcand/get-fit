# Mon Héros — Spécifications du système

Document de référence pour l'implémentation dans `hero.js`. Toutes les constantes viennent du classeur de balance et doivent y rester synchronisées.

---

## 1. Principes d'architecture

**Trois règles à ne jamais casser.**

1. **Toutes les fonctions de calcul sont pures.** Elles prennent un état, retournent un nouvel état ou une valeur. Aucun accès au DOM, aucun accès direct au `localStorage`. Ça permet de les tester dans la console et de rejouer une journée entière sans toucher à l'interface.
2. **Une seule source de vérité pour les constantes** — l'objet `CONFIG` en haut du fichier. Aucun nombre magique ailleurs dans le code.
3. **L'état du jeu est dérivable.** Le niveau se recalcule depuis l'XP cumulée, les stats depuis le niveau et l'équipement. On ne stocke jamais une valeur qu'on peut recalculer, sauf pour la performance.

**Découpage des fichiers**

| Fichier | Responsabilité |
|---|---|
| `hero.js` | Tout le système de jeu : config, calculs, résolution, sauvegarde |
| `bestiaire.js` | Données pures : monstres, cycles, noms d'objets. Aucune logique |
| `workout.js` | Appelle `gagnerXP()` quand une séance est loggée |
| `nutrition.js` | Appelle `evaluerJourNutrition()` à la clôture d'une journée |
| `shared.js` | Utilitaires de date, `localStorage`, formatage |

`hero.js` ne connaît ni `workout.js` ni `nutrition.js`. Ce sont eux qui l'appellent. Dépendance à sens unique.

---

## 2. CONFIG — toutes les constantes

```js
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
```

### Profils de conversion puissance → stats

Chaque objet a une **puissance** unique. Le slot décide de ce que cette puissance devient. Les coefficients sont calibrés pour que six pièces équipées donnent exactement les ratios validés dans le simulateur de combat (ATQ ×1,00 · PV ×4,80 · DEF ×0,50 de la puissance unitaire).

```js
const PROFILS_SLOT = {
  arme:      { atq: 0.85, crit: 0.00010 },
  casque:    { pv: 1.40,  def: 0.08 },
  plastron:  { pv: 2.20,  def: 0.17 },
  jambieres: { pv: 1.20,  def: 0.25 },
  bague:     { atq: 0.15, crit: 0.00025 },
  collier:   { chance: 0.10, bonusXP: 0.0004 }
};
```

Le bonus XP du collier est plafonné à +15 %. Sans ce plafond, il finit par écraser la contribution de la nutrition, ce qui viderait celle-ci de son sens.

---

## 3. Structures de données

### Objet d'équipement

```js
{
  id: 'obj_1757400000_a3f',   // timestamp + suffixe aléatoire
  slot: 'plastron',
  rarete: 'rare',
  palier: 8,                   // palier de drop — fige la puissance de base
  cycle: 5,                    // cycle de drop — fige le facteur de croissance
  forge: 0,                    // 0 à 10
  nom: 'Cuirasse de bronze',   // purement cosmétique, vient de bestiaire.js
  obtenuLe: '2026-09-09'
}
```

La puissance n'est **jamais stockée** — elle se recalcule. Ça évite qu'un rééquilibrage laisse des objets fantômes avec d'anciennes valeurs.

### État du héros

```js
{
  version: 1,
  xpTotal: 24310,
  moral: 100,
  or: 12400,
  essence: 218,
  gemmes: 34,
  ameliorationsEssence: 6,     // achetées, sert au coût escaladant

  equipe:    { arme: 'obj_...', casque: null, plastron: 'obj_...', ... },
  inventaire: [ /* objets non équipés */ ],

  donjon: {
    cycle: 5,
    palierAtteint: 0,          // 0 = pas encore descendu ce cycle
    descentesDisponibles: 2,
    derniereDescente: '2026-09-09'
  },

  compteurs: {
    pityLegendaire: 12,        // objets largués depuis le dernier légendaire
    streakSemaines: 6,
    streakNutritionJours: 4,
    seancesSemaineCourante: 3,
    semaineCourante: '2026-W37'
  },

  journal: [ /* 30 derniers événements, pour l'affichage */ ]
}
```

### Bestiaire (données pures)

```js
const CYCLES = [
  { n: 1, nom: 'Le Lion de Némée',  boss: 'Lion de Némée',  monstres: ['Satyre', 'Harpie', ...] },
  { n: 2, nom: "L'Hydre de Lerne",  boss: 'Hydre',          monstres: [...] },
  // ... 12 Travaux, puis monstres libres au-delà
];
```

Au-delà du cycle 12, on pioche dans une liste de monstres libres (Minotaure, Méduse, Chimère, Sphinx, Charybde, Talos) avec un suffixe de cycle.

---

## 4. Fonctions de progression

### Courbe d'XP

```js
function xpRequisPourNiveau(niveau) {
  if (niveau <= 1) return 0;
  const L = niveau - 1;
  const { courbeCoeff: c, courbeExposant: e, softCap, incrementApresCap } = CONFIG.xp;
  return L <= softCap
    ? Math.round(c * Math.pow(L, e))
    : Math.round(c * Math.pow(softCap, e) + incrementApresCap * (L - softCap));
}
```

`xpCumulPourNiveau(n)` = somme de 1 à n. **À précalculer une fois** au chargement dans un tableau `TABLE_XP[1..50]` — cette fonction est appelée à chaque rendu et une boucle imbriquée serait du gaspillage.

```js
function niveauDepuisXP(xpTotal) {
  for (let n = CONFIG.xp.niveauMax; n >= 1; n--) {
    if (xpTotal >= TABLE_XP[n]) return n;
  }
  return 1;
}
```

### Gain d'XP d'une séance

```js
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
  const multCollier = 1 + bonusXPCollier(etat);   // plafonné à 0,15

  return {
    brut: Math.round(brut),
    final: Math.round(brut * multNutrition * multMoral * multStreak * multCollier),
    detail: { volume, multNutrition, multMoral, multStreak, multCollier }
  };
}
```

Le champ `detail` n'est pas décoratif : l'interface doit pouvoir montrer d'où vient chaque point d'XP. C'est ce qui rend le lien entre nutrition et récompense visible, donc motivant.

### Moral

```js
function multiplicateurMoral(moral) {
  const { multMin, seuilPlein } = CONFIG.moral;
  return multMin + (1 - multMin) * Math.min(moral, seuilPlein) / seuilPlein;
}

function ajusterMoral(etat, delta) {
  etat.moral = Math.max(0, Math.min(CONFIG.moral.max, etat.moral + delta));
}
```

Le moral ne descend jamais sous 0 ni au-dessus de 100. Aucun autre chemin ne doit le modifier.

### Nutrition — bonus pur, jamais de pénalité

Trois cibles indépendantes. Chacune ajoute son propre bonus si elle est atteinte ce jour-là ; aucune ne peut jamais rendre le multiplicateur inférieur à 1,00.

```js
function evaluerJourNutrition(totaux, cibles) {
  if (totaux === null) return null;   // rien loggé = neutre, pas de calcul du tout

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
```

**Règle critique :** une journée sans aucun aliment loggé retourne `null`, pas un objet avec des `false` partout. `null` court-circuite tout calcul de bonus ET ne touche jamais à la série. C'est toute la différence entre « la nutrition est optionnelle » et « la nutrition est pénalisante par absence ». À ne pas confondre dans le code — un piège facile est de faire `totaux || {calories: 0, ...}` quelque part en amont, ce qui transformerait silencieusement `null` en un jour raté.

### Série nutritionnelle (2 cibles ou plus, jours consécutifs)

Un jour compte pour la série dès que **2 des 3 cibles** sont atteintes — pas besoin des trois. Un jour sous ce seuil, y compris un jour non loggé, la casse à zéro, mais ne fait jamais reculer le multiplicateur sous 1,00.

```js
function mettreAJourSerieNutrition(etat, evalJour) {
  if (evalJour === null) {
    etat.compteurs.streakNutritionJours = 0;      // rien loggé casse la série
    return;
  }
  etat.compteurs.streakNutritionJours = evalJour.compteSerie
    ? etat.compteurs.streakNutritionJours + 1
    : 0;                                           // moins de 2 cibles casse la série
}

function bonusSerieNutrition(etat) {
  const n = CONFIG.nutrition;
  return Math.min(etat.compteurs.streakNutritionJours * n.bonusSerieParJour, n.bonusSerieMax);
}
```

Le multiplicateur du jour combine les deux :

```js
function multiplicateurNutritionDuJour(etat, evalJour) {
  if (evalJour === null) return 1;   // neutre, aucun calcul
  return 1 + evalJour.bonusJour + bonusSerieNutrition(etat);
}
```

À 15 jours de série et une journée où 2 cibles sont atteintes (calories + protéines, par exemple) : `1 + 0,13 + 0,15 = 1,28`, soit +28 % d'XP sur la séance. Avec les 3 cibles le même jour, jusqu'à `1 + 0,17 + 0,15 = 1,32`.

### Stats effectives

```js
function calculerStats(etat) {
  const niveau = niveauDepuisXP(etat.xpTotal);
  const s = CONFIG.stats;

  let stats = {
    pv:     s.pvBase  + s.pvParNiveau  * (niveau - 1),
    atq:    s.atqBase + s.atqParNiveau * (niveau - 1),
    def:    s.defBase + s.defParNiveau * (niveau - 1),
    crit:   s.critBase + s.critGainMax * (niveau / (niveau + s.critK)),
    chance: 0,
    bonusXP: 0
  };

  for (const slot of SLOTS) {
    const objet = trouverObjet(etat, etat.equipe[slot]);
    if (!objet) continue;
    const p = puissanceObjet(objet);
    for (const [stat, coeff] of Object.entries(PROFILS_SLOT[slot])) {
      stats[stat] += p * coeff;
    }
  }

  stats.chance += chanceDepuisNutrition(etat);
  stats.bonusXP = Math.min(stats.bonusXP, 0.15);
  return stats;
}

function puissanceObjet(o) {
  const e = CONFIG.equipement;
  return (e.puissanceBase + e.puissanceParPalier * o.palier)
       * e.multRarete[o.rarete]
       * Math.pow(1 + CONFIG.donjon.croissanceParCycle, o.cycle - 1)
       * (1 + e.gainParForge * o.forge);
}
```

---

## 5. Résolution du donjon

C'est le cœur du système. La fonction est **déterministe sauf pour le loot**, ce qui la rend testable.

```js
function resoudreDescente(etat) {
  const stats = calculerStats(etat);
  const d = CONFIG.donjon;
  const cycle = etat.donjon.cycle;
  const croissance = Math.pow(1 + d.croissanceParCycle, cycle - 1);

  let pv = stats.pv;
  const resultat = { paliers: [], reussie: false, or: 0, essence: 0, loot: [] };

  for (let palier = 1; palier <= d.paliers; palier++) {
    const boss = palier === d.paliers;

    const ennemi = {
      pv:  Math.round(d.ennemiPvBase  * Math.pow(palier, d.ennemiPvExposant)  * croissance * (boss ? d.bossMultPv  : 1)),
      atq: Math.round(d.ennemiAtqBase * Math.pow(palier, d.ennemiAtqExposant) * croissance * (boss ? d.bossMultAtq : 1)),
      def: Math.round(d.ennemiDefBase * Math.pow(palier, d.ennemiDefExposant) * croissance)
    };

    const degatsInfliges = Math.max(1, stats.atq * (1 - ennemi.def / (ennemi.def + CONFIG.stats.armureK)));
    const dps    = degatsInfliges * (1 + stats.crit * (CONFIG.stats.critMult - 1));
    const tours  = Math.min(Math.ceil(ennemi.pv / dps), d.toursMax);
    const subis  = Math.max(1, ennemi.atq * (1 - stats.def / (stats.def + CONFIG.stats.armureK)));

    // régénération AVANT le combat, sauf au tout premier palier
    if (palier > 1) pv = Math.min(stats.pv, pv + stats.pv * d.regenEntrePaliers);

    // le joueur frappe en premier : il n'encaisse que (tours - 1) ripostes
    pv -= subis * Math.max(0, tours - 1);

    if (pv <= 0) {
      resultat.paliers.push({ palier, boss, reussi: false, pvRestants: 0 });
      break;
    }

    resultat.paliers.push({ palier, boss, reussi: true, tours, pvRestants: Math.round(pv) });
    resultat.or      += Math.round(CONFIG.economie.orParPalier * palier
                                   * (1 + CONFIG.economie.bonusOrParCycle * (cycle - 1)));
    resultat.essence += CONFIG.economie.essenceParPalier + (boss ? CONFIG.economie.essenceBoss : 0);

    const objet = tenterDrop(etat, palier, cycle, stats.chance);
    if (objet) resultat.loot.push(objet);

    if (boss) resultat.reussie = true;
  }
  return resultat;
}
```

**Trois détails qui changent tout et qu'il est facile de rater :**

- La régénération s'applique **avant** le combat du palier, pas après. Sinon le boss profite d'une régénération qu'il n'a pas méritée et la difficulté finale s'effondre.
- Le joueur frappe en premier, donc il encaisse `tours - 1` ripostes, pas `tours`. Aux paliers courts (1 à 2 tours) ça change complètement l'équilibre.
- `toursMax` évite qu'un personnage sous-équipé fasse tourner une boucle quasi infinie contre un boss qu'il ne peut pas entamer.

### Après la descente

```js
function appliquerDescente(etat, resultat) {
  etat.or      += resultat.or;
  etat.essence += resultat.essence;
  etat.inventaire.push(...resultat.loot);
  etat.donjon.descentesDisponibles--;

  if (resultat.reussie) {
    etat.donjon.cycle++;
    etat.donjon.palierAtteint = 0;
  } else {
    etat.donjon.palierAtteint = 0;   // échec = retour au palier 1
  }
}
```

Un échec ne coûte **jamais** de ressources déjà gagnées. Les paliers nettoyés avant la mort rapportent quand même.

### Descentes disponibles

Une descente automatique par jour, plus une par séance loggée, cumulables jusqu'à 5. Ce choix relie directement l'activité du donjon à l'entraînement réel — sans lui, le donjon tourne tout seul et l'app n'a plus besoin de toi.

```js
function crediterDescentes(etat, aujourdhui) {
  const jours = joursEcoules(etat.donjon.derniereDescente, aujourdhui);
  if (jours > 0) {
    etat.donjon.descentesDisponibles = Math.min(
      CONFIG.descentes.maxAccumulees,
      etat.donjon.descentesDisponibles + jours * CONFIG.descentes.parJour
    );
    etat.donjon.derniereDescente = aujourdhui;
  }
}
```

Le rattrapage hors-ligne se fait ici : au chargement, on crédite les jours écoulés, puis on résout les descentes en attente une par une. On ne simule jamais le temps écoulé heure par heure.

---

## 6. Loot

```js
function tenterDrop(etat, palier, cycle, chance) {
  if (Math.random() >= CONFIG.loot.tauxDrop) return null;

  etat.compteurs.pityLegendaire++;
  const rarete = tirerRarete(etat, chance);
  if (rarete === 'legendaire') etat.compteurs.pityLegendaire = 0;

  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
  return {
    id: 'obj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    slot, rarete, palier, cycle, forge: 0,
    nom: nomObjet(slot, rarete),
    obtenuLe: dateDuJour()
  };
}

function tirerRarete(etat, chance) {
  const l = CONFIG.loot;
  const c = etat.compteurs.pityLegendaire;

  if (c >= l.pityDur) return 'legendaire';                      // pity dur

  const bonusPity = Math.max(0, c - l.pityDouxDebut) * l.pityDouxIncrement;
  if (bonusPity > 0 && Math.random() < bonusPity) return 'legendaire';

  // la Chance déplace du poids vers le haut, proportionnellement au rang
  const poids = RARETES.map((r, i) => l.poids[r] * (1 + chance * l.effetChance * i));
  const total = poids.reduce((a, b) => a + b, 0);
  let tirage = Math.random() * total;
  for (let i = 0; i < RARETES.length; i++) {
    tirage -= poids[i];
    if (tirage <= 0) return RARETES[i];
  }
  return 'commun';
}
```

Le compteur de pity s'incrémente à **chaque objet largué**, pas à chaque palier. C'est ce que le classeur calcule.

---

## 7. Fusion et vente

```js
function peutFusionner(etat, slot, rarete) {
  const candidats = etat.inventaire.filter(o => o.slot === slot && o.rarete === rarete);
  return candidats.length >= CONFIG.fusion.objetsRequis
      && etat.or >= coutFusion(rarete);
}

function coutFusion(rarete) {
  const i = RARETES.indexOf(rarete);
  return Math.round(CONFIG.fusion.coutOrBase * Math.pow(CONFIG.fusion.facteurCoutOr, i));
}

function fusionner(etat, idsObjets) {
  const objets = idsObjets.map(id => trouverObjet(etat, id));
  const { slot, rarete } = objets[0];

  // garde-fous — la fonction doit être sûre même si l'UI se trompe
  if (objets.length !== CONFIG.fusion.objetsRequis) throw new Error('Il faut 3 objets');
  if (!objets.every(o => o.slot === slot && o.rarete === rarete)) throw new Error('Slot ou rareté différents');
  if (rarete === 'legendaire') throw new Error('Rareté maximale atteinte');
  if (etat.or < coutFusion(rarete)) throw new Error('Or insuffisant');

  const chance = calculerStats(etat).chance;
  const sautDouble = Math.random() < chance * CONFIG.fusion.chanceSautDoubleParPoint;
  const rang = RARETES.indexOf(rarete);
  const nouveauRang = Math.min(rang + (sautDouble ? 2 : 1), RARETES.length - 1);

  etat.or -= coutFusion(rarete);
  etat.inventaire = etat.inventaire.filter(o => !idsObjets.includes(o.id));

  const resultat = {
    id: 'obj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    slot,
    rarete: RARETES[nouveauRang],
    palier: Math.max(...objets.map(o => o.palier)),   // hérite du meilleur palier
    cycle:  Math.max(...objets.map(o => o.cycle)),
    forge: 0,
    nom: nomObjet(slot, RARETES[nouveauRang]),
    obtenuLe: dateDuJour()
  };
  etat.inventaire.push(resultat);
  return { objet: resultat, sautDouble };
}

function prixVente(objet) {
  return Math.round(puissanceObjet(objet) * CONFIG.vente.coefficientPrix);
}
```

Un objet équipé ne peut être ni vendu ni fusionné — à vérifier avant toute opération.

---

## 8. Sauvegarde

```js
const CLE_SAUVEGARDE = 'getfit_hero_v1';

function sauvegarder(etat) {
  localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify(etat));
}

function charger() {
  const brut = localStorage.getItem(CLE_SAUVEGARDE);
  if (!brut) return etatInitial();
  const etat = migrer(JSON.parse(brut));
  crediterDescentes(etat, dateDuJour());
  return etat;
}

function migrer(etat) {
  if (!etat.version) etat.version = 1;
  // chaque changement de structure ajoute un bloc ici, jamais une réécriture
  return etat;
}
```

**Prévois `migrer()` dès maintenant, même vide.** Tu vas rééquilibrer, et le jour où tu ajoutes un champ, une sauvegarde existante sans ce champ fera planter le rendu. C'est cinq lignes maintenant contre une soirée perdue plus tard.

Le code de sauvegarde exportable (comme dans le tracker nutrition) : `btoa(JSON.stringify(etat))`, avec un `try/catch` à la restauration et une validation minimale des champs obligatoires avant d'écraser l'état courant.

---

## 9. Points d'intégration

```js
// workout.js — après l'enregistrement d'une séance
const gain = HERO.gagnerXP(seance);
HERO.ajusterMoral(CONFIG.moral.seance);
HERO.crediterDescente(CONFIG.descentes.bonusParSeance);

// nutrition.js — à la clôture d'une journée
const evalJour = HERO.evaluerJourNutrition(totaux, cibles);  // null si rien loggé
HERO.mettreAJourSerieNutrition(evalJour);
```

`gagnerXP()` doit retourner l'objet complet du gain, pas juste un nombre : l'interface a besoin du niveau avant/après, des gemmes gagnées et du détail des multiplicateurs pour animer la montée de niveau.

---

## 10. Ordre de construction suggéré

1. `CONFIG` + `TABLE_XP` + `niveauDepuisXP` + `calculerStats` — vérifiable en console contre l'onglet Progression du classeur
2. `calculerXPSeance` + moral + branchement sur `workout.js`
3. `resoudreDescente` — comparer palier par palier avec l'onglet Sim Combat
4. Loot + inventaire
5. Fusion + vente
6. Sauvegarde et migration
7. Bestiaire et habillage grec

**Étape de validation à ne pas sauter :** après l'étape 3, prends les entrées de l'onglet Sim Combat (niveau 11, cycle 5, équipement type) et vérifie que ton code sort les mêmes PV restants palier par palier. Si ça diverge, c'est presque toujours l'ordre régénération/combat ou le `tours - 1`.

---

*Constantes synchronisées avec le classeur de balance. Toute modification de l'un doit être reportée dans l'autre.*
