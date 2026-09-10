"use strict";

/* ================================================================
   BESTIAIRE — données pures : cycles de donjon (thème des 12 Travaux
   d'Héraclès), monstres et noms d'objets. Aucune logique de jeu ici,
   seulement des tables que hero.js consulte.
   ================================================================ */

const MONSTRES_MINEURS = [
  { nom: "Satyre",           icone: "🐐" },
  { nom: "Harpie",           icone: "🦅" },
  { nom: "Centaure",         icone: "🐎" },
  { nom: "Gorgone",          icone: "🐍" },
  { nom: "Cyclope",          icone: "👁️" },
  { nom: "Sirène",           icone: "🧜" },
  { nom: "Griffon",          icone: "🦁" },
  { nom: "Titan mineur",     icone: "⛰️" },
  { nom: "Spectre du Styx",  icone: "👻" },
  { nom: "Golem de bronze",  icone: "🗿" },
  { nom: "Loup de Scythie",  icone: "🐺" },
  { nom: "Satyre archer",    icone: "🏹" },
  { nom: "Naïade hostile",   icone: "💧" },
  { nom: "Ombre du Tartare", icone: "🌑" }
];

// Les 12 Travaux d'Héraclès : un boss par cycle, thème purement cosmétique.
const CYCLES = [
  { n: 1,  nom: "Le Lion de Némée",             boss: { nom: "Lion de Némée",            icone: "🦁" } },
  { n: 2,  nom: "L'Hydre de Lerne",              boss: { nom: "Hydre de Lerne",           icone: "🐉" } },
  { n: 3,  nom: "La Biche de Cérynie",           boss: { nom: "Biche de Cérynie",         icone: "🦌" } },
  { n: 4,  nom: "Le Sanglier d'Érymanthe",       boss: { nom: "Sanglier d'Érymanthe",     icone: "🐗" } },
  { n: 5,  nom: "Les Écuries d'Augias",          boss: { nom: "Gardien des écuries",      icone: "🐂" } },
  { n: 6,  nom: "Les Oiseaux du lac Stymphale",  boss: { nom: "Volée stymphalienne",      icone: "🦢" } },
  { n: 7,  nom: "Le Taureau de Crète",           boss: { nom: "Taureau de Crète",         icone: "🐮" } },
  { n: 8,  nom: "Les Juments de Diomède",        boss: { nom: "Juments de Diomède",       icone: "🐴" } },
  { n: 9,  nom: "La Ceinture d'Hippolyte",       boss: { nom: "Hippolyte",                icone: "🛡️" } },
  { n: 10, nom: "Les Bœufs de Géryon",           boss: { nom: "Géryon",                   icone: "👹" } },
  { n: 11, nom: "Les Pommes des Hespérides",     boss: { nom: "Ladon, gardien du jardin",  icone: "🐲" } },
  { n: 12, nom: "Cerbère",                       boss: { nom: "Cerbère",                  icone: "🐕" } }
];

// Au-delà du cycle 12, plus de Travaux nommés : bestiaire libre, suffixé par
// le numéro de cycle pour garder un peu de variété.
const MONSTRES_LIBRES = [
  { nom: "Minotaure", icone: "🐂" },
  { nom: "Méduse",    icone: "🐍" },
  { nom: "Chimère",   icone: "🔥" },
  { nom: "Sphinx",    icone: "🦂" },
  { nom: "Charybde",  icone: "🌊" },
  { nom: "Talos",     icone: "⚙️" }
];

function monstrePourPalier(cycle, palier) {
  const i = (cycle - 1) * 9 + (palier - 1);
  return MONSTRES_MINEURS[i % MONSTRES_MINEURS.length];
}

function nomCycle(cycle) {
  if (cycle <= CYCLES.length) return CYCLES[cycle - 1].nom;
  const libre = MONSTRES_LIBRES[(cycle - CYCLES.length - 1) % MONSTRES_LIBRES.length];
  return libre.nom + " — cycle " + cycle;
}

function bossPourCycle(cycle) {
  if (cycle <= CYCLES.length) return CYCLES[cycle - 1].boss;
  const libre = MONSTRES_LIBRES[(cycle - CYCLES.length - 1) % MONSTRES_LIBRES.length];
  return { nom: libre.nom + " (cycle " + cycle + ")", icone: libre.icone };
}

/* ---------------- Noms d'objets ---------------- */
const PREFIXES_RARETE = {
  commun:     ["rouillé", "de cuir", "usé", "de bronze terni"],
  rare:       ["gravé", "d'argent", "runique", "du hoplite"],
  ultraRare:  ["de bronze céleste", "du héros", "sacré", "de l'oracle"],
  mythique:   ["des Titans", "de l'Olympe", "immortel", "du fleuve Styx"],
  legendaire: ["de Zeus", "des Champs Élysées", "divin", "forgé par Héphaïstos"]
};

const NOMS_BASE = {
  arme:      ["Épée", "Lance", "Hache", "Glaive", "Trident"],
  casque:    ["Heaume", "Casque", "Couronne de bronze"],
  plastron:  ["Cuirasse", "Plastron", "Égide"],
  jambieres: ["Jambières", "Cnémides", "Grèves"],
  bague:     ["Anneau", "Sceau", "Bague"],
  collier:   ["Collier", "Amulette", "Pendentif"]
};

function nomObjet(slot, rarete) {
  const bases = NOMS_BASE[slot] || ["Objet"];
  const prefixes = PREFIXES_RARETE[rarete] || PREFIXES_RARETE.commun;
  const base = bases[Math.floor(Math.random() * bases.length)];
  const prefixe = prefixes[Math.floor(Math.random() * prefixes.length)];
  return base + " " + prefixe;
}
