# Mon Héros — Phase 2 : équipement, donjon auto, essence et gemmes

Contexte : le projet get-fit est maintenant en plusieurs fichiers statiques (index.html,
style.css, shared.js, nutrition.js, workout.js, hero.js), servis sans build sur GitHub
Pages. `hero.js` contient déjà la Phase 1 de "Mon Héros" : personnage avec niveau/XP/
stats, or, une arme équipable, attaque manuelle contre un monstre unique qui progresse
indéfiniment, coffres commun/rare achetés avec l'or.

**IMPORTANT** : lis d'abord `hero.js` (et les points de `workout.js` où il est appelé,
ex. à la fin d'une séance) pour connaître les vrais noms de fonctions/variables/clés en
place — ils peuvent différer de ce qui est décrit ci-dessous. Réutilise-les.

Cette passe **remplace** le combat manuel à monstre unique par un donjon automatique, et
ajoute l'équipement multi-emplacements, une ressource farmable (Essence) et une ressource
liée uniquement au vrai entraînement (Gemmes). Gère la migration des données existantes
(voir tout en bas).

## 1. Équipement — 6 emplacements

Remplace le slot unique `equippedWeaponId` par un objet d'équipement à 6 emplacements :

```js
state.hero.equipment = {
  weapon: null, helmet: null, chestplate: null, leggings: null,
  ring: null, necklace: null
}  // chaque valeur est un id d'objet dans state.hero.inventory, ou null
```

- Chaque objet d'inventaire a désormais un champ `slot` (une des 6 valeurs ci-dessus) en
  plus de `bonus` et `rarity`
- Stats totales du personnage = stats de base (issues du niveau) + somme des bonus de
  TOUS les objets actuellement équipés (les 6 emplacements, pas juste l'arme)
- Interface : dans la carte inventaire, groupe les objets par emplacement (ou affiche
  l'emplacement sur chaque carte d'objet), bouton "Équiper"/"Retirer" par objet — un seul
  objet actif par emplacement à la fois
- Vue "Équipement actuel" : les 6 emplacements affichés (ex. en grille), vide ou avec le
  nom de l'objet équipé, cliquable pour aller à l'inventaire

## 2. Donjon automatique (remplace le combat manuel à monstre unique)

Retire le bouton "Attaquer" manuel, `attackCharges`, `currentMonster` et `monsterIndex`
de la Phase 1. Remplace par :

```js
state.hero.dungeon = {
  stage: 1,          // 1 à 10, 10 = boss
  essence: 0,         // ressource farmable
  lastTick: Date.now() // timestamp du dernier combat résolu, pour le rattrapage hors-ligne
}
```

**Résolution d'un combat (une "tentative") :**
- Puissance du joueur = somme des 3 stats totales (base + tout l'équipement)
- Difficulté du palier = `15 * 1.35^stage`, avec un ×1.5 supplémentaire si `stage === 10`
  (le boss)
- Probabilité de victoire = `puissance / (puissance + difficulté)`, bornée entre 0.05 et
  0.95 (jamais totalement garanti ni totalement impossible)
- Tirage aléatoire : victoire ou échec selon cette probabilité

**Palier réussi :**
- Essence gagnée = `2 + stage` (banquée immédiatement, jamais perdue même en cas
  d'échec futur)
- Or gagné = `3 + stage * 2`
- Chance de drop d'objet = `10% + stage * 2%`, rareté commune ou rare seulement (jamais
  légendaire — réservé aux gemmes, voir plus bas), pondérée vers "rare" aux paliers plus
  élevés
- `stage += 1`

**Palier 10 (boss) réussi :**
- Essence et or ×3 par rapport à la formule normale
- Drop d'objet garanti (100%), au moins rareté "rare"
- `stage` revient à 1 (le donjon recommence, répétable indéfiniment)

**Palier échoué :** `stage` revient immédiatement à 1. Rien n'est perdu de ce qui a déjà
été banqué lors des paliers précédents de cette tentative.

**Cadence automatique :**
- Une constante en haut de hero.js, ex. `const DUNGEON_TICK_SECONDS = 20;`
- **Pendant que l'onglet Mon Héros est ouvert et visible** : un intervalle résout un
  combat toutes les `DUNGEON_TICK_SECONDS` secondes, avec une petite animation (barre de
  vie du monstre qui descend, résultat affiché brièvement) avant de passer au suivant
- **Au chargement de la page** (rattrapage hors-ligne) : calcule le temps écoulé depuis
  `lastTick`, déduis le nombre de tentatives à simuler (`elapsedMs / (DUNGEON_TICK_SECONDS
  * 1000)`), plafonné à une constante `const MAX_OFFLINE_TICKS = 100;` pour éviter des
  résultats absurdes après une longue absence. Résous ces tentatives silencieusement
  (sans animation, juste calcul des résultats), puis affiche un résumé du type "Pendant
  ton absence : 12 paliers franchis, +45 essence, +80 or, 2 objets trouvés"
- Met à jour `lastTick = Date.now()` après chaque résolution (live ou rattrapage)

**Interface du donjon :**
- Carte "Donjon" : palier actuel affiché ("Palier 4/10" ou "⚔️ BOSS" au palier 10), barre
  de vie du monstre pendant l'animation, dernier résultat (réussite/échec)
- Petit historique des derniers résultats (facultatif, 3-5 dernières lignes)

## 3. Essence (ressource farmable, dépensée en petites améliorations)

- Dépensée dans une nouvelle sous-section "Améliorer" : un bouton par stat (Force,
  Endurance, Vitesse), chacun donnant `+0.5` à la stat de base pour un coût croissant
  (ex. coût = `10 * 1.5^(nombre d'achats déjà faits sur cette stat)`, arrondi)
- Ces bonus s'ajoutent aux stats de base indépendamment du niveau ou de l'équipement
- Affiche le coût du prochain achat sur chaque bouton, désactivé si pas assez d'essence

## 4. Gemmes (uniquement via montée de niveau réelle)

- `state.hero.gems` (nombre), inchangé dans son obtention : +1 gemme à chaque montée de
  niveau (dans la logique déjà en place suite à une vraie séance), +3 bonus supplémentaires
  tous les 5 niveaux (niveau 5, 10, 15...)
- Deux usages, dans une carte "Trésor" ou similaire :
  1. **Coffre légendaire** (coût ex. 5 gemmes) : ouvre un coffre garanti rareté
     "légendaire" — nouvelle table de butin légendaire (bonus +6 à +10, un ou plusieurs
     emplacements), la seule source de cette rareté dans tout le jeu
  2. **Forge** (coût ex. 3 gemmes) : choisis un objet déjà possédé (équipé ou non) dans
     l'inventaire, dépense les gemmes pour augmenter définitivement chacun de ses bonus
     de stat de +1 (garde un compteur `upgradeCount` sur l'objet, affiche-le dans son nom,
     ex. "Épée en fer +2")

## 5. Migration des données existantes (obligatoire, ne pas casser les sauvegardes)

Au chargement, si `state.hero` existe mais vient de la Phase 1 (présence de
`attackCharges`, `monsterIndex`, `currentMonster` ou `equippedWeaponId` sans
`equipment`) :
- Convertis `equippedWeaponId` (s'il existe et non nul) en `equipment.weapon` avec le
  même id, tous les autres emplacements à `null`
- Ajoute un champ `slot: "weapon"` aux objets d'inventaire existants qui n'en ont pas
  (ils étaient tous des armes en Phase 1)
- Initialise `state.hero.dungeon = { stage: 1, essence: 0, lastTick: Date.now() }`
- Initialise `state.hero.gems = 0` si absent
- Supprime `attackCharges`, `monsterIndex`, `currentMonster` de l'objet (ne plus les
  utiliser)
- Un utilisateur sans `state.hero` du tout (jamais ouvert Mon Héros) part directement sur
  la structure complète par défaut, pas besoin de migration

## Contraintes générales

- Même style visuel que le reste (cartes arrondies, transitions douces), accents "jeu"
  cohérents avec la Phase 1
- Tout en français
- Inclus toutes les nouvelles données (equipment, dungeon, gems) dans le code de
  sauvegarde (buildSaveCode / restauration dans shared.js)
- Vérifie la syntaxe de tous les fichiers .js modifiés avant de committer (node --check)
- Une fois terminé, commit + push (le hook PostToolUse s'en charge automatiquement)
