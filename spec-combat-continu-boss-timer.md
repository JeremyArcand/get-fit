# Mon Héros — Combat continu (dégâts par seconde) + minuteur de boss

Contexte : get-fit contient déjà hero.js avec le personnage, l'équipement à 6
emplacements, le donjon (paliers 1-10, essence, or, gemmes, coffres), et les sprites
réels du héros (hero-idle.png + séquence hero-attack-NN.png) tout juste intégrés.

**IMPORTANT** : lis d'abord `hero.js` en entier pour connaître la logique actuelle de
résolution d'un combat de donjon (probablement basée sur une probabilité de
victoire/défaite par tentative) — cette passe la **remplace entièrement** par le
mécanisme décrit ci-dessous, plus proche d'un "monster clicker" classique : dégâts
garantis à intervalle régulier, victoire certaine à terme sauf pour le boss qui a un
minuteur strict.

## Nouveau modèle de combat

**Palier normal (1 à 9) :**
- Le personnage attaque automatiquement toutes les `DUNGEON_TICK_SECONDS` secondes
  (constante en haut de hero.js, valeur par défaut `1`)
- Chaque attaque inflige des dégâts fixes au monstre actuel (réutilise la formule de
  puissance déjà en place : `3 + floor(force / 2) + bonus d'arme équipée`), joue
  l'animation d'attaque déjà en place (flipbook `hero-attack-*.png` + flash/dégâts
  flottants côté monstre)
- Le monstre actuel **garde ses PV d'une attaque à l'autre** (pas de tirage
  victoire/défaite par tentative comme avant) — les PV descendent progressivement
  jusqu'à zéro
- Monstre vaincu (PV ≤ 0) : accorde essence/or/chance de drop selon les formules déjà
  en place pour ce palier, `stage += 1`, génère le monstre suivant (PV pleins, selon le
  roster de monstres déjà en place) avec des PV totaux plus élevés que le précédent
  (garde ou ajuste la formule de scaling déjà en place)
- Comme les dégâts sont garantis et réguliers, TOUS les monstres des paliers 1 à 9 sont
  battables à terme, seulement plus ou moins vite selon la puissance du personnage —
  c'est voulu, aucun tirage aléatoire de victoire/défaite sur ces paliers

**Palier 10 (boss) — minuteur strict :**
- En atteignant le palier 10, **mets l'attaque automatique en pause** et affiche la
  bannière d'entrée en combat de boss déjà en place, avec un bouton **"Commencer le
  combat"** — ne démarre PAS le minuteur tout seul, le joueur doit cliquer
- Au clic : démarre un minuteur de `BOSS_TIME_LIMIT_SECONDS` secondes (constante,
  défaut `60`), affiché clairement (ex. "0:47" qui descend), et reprends les attaques
  automatiques au même rythme que les paliers normaux pendant que le minuteur tourne
- **Boss vaincu avant la fin du minuteur** : accorde les récompenses de boss déjà en
  place (essence/or ×3, drop garanti), `run += 1` (nouveau champ, voir migration),
  `stage = 1`, génère un nouveau monstre de palier 1, reprend l'attaque automatique
  normalement. Affiche un message de victoire.
- **Minuteur à zéro avant que le boss soit vaincu** : le combat de boss échoue,
  `stage = 1` (le `run` ne change pas), génère un nouveau monstre de palier 1, reprend
  l'attaque automatique normalement. Tout ce qui a déjà été gagné plus tôt dans cette
  tentative (essence, or, drops des paliers 1-9 précédents) reste acquis.

## Affichage

- Remplace l'affichage "Palier X/10" par un format "Run [run] · Palier [stage]/10" (ex.
  "Run 1 · Palier 4/10"). Au palier 10, affiche plutôt "⚔️ BOSS" à la place du numéro de
  palier, avec le minuteur bien visible pendant le combat
- Garde la barre de vie du monstre actuel, les animations déjà en place (flash, dégâts
  flottants, mort avec particules, flipbook d'attaque du héros)

## Rattrapage hors-ligne (au chargement de la page)

- Calcule le temps écoulé depuis `lastTick`, simule le nombre de secondes/attaques
  correspondant (une attaque par `DUNGEON_TICK_SECONDS`), plafonné à une constante
  `MAX_OFFLINE_SECONDS` (ex. 1800 = 30 minutes de rattrapage max)
- Simule ces attaques silencieusement contre les monstres normaux (paliers 1-9),
  cascade automatiquement d'un monstre vaincu au suivant comme en direct
- **Si la simulation atteint le palier 10 (boss) à un moment donné, arrête la
  simulation immédiatement à ce point-là** — ne résous jamais un combat de boss hors
  ligne sans que le joueur soit présent pour voir le minuteur. Laisse `stage = 10`,
  boss pas encore commencé, prêt pour un clic sur "Commencer le combat" au retour du
  joueur
- Affiche un résumé du rattrapage comme déjà prévu ("Pendant ton absence : ...")
- Met à jour `lastTick = Date.now()` après le rattrapage

## Migration des données existantes

Au chargement, si `state.hero.dungeon` existe déjà mais vient de l'ancien système
(pas de champ `run`, ou `currentMonster` sans PV qui persistent) :
- Ajoute `run: 1` si absent
- Si `currentMonster` est absent ou incohérent, régénère-le à PV pleins pour le
  `stage` actuel
- Ajoute `bossFightActive: false` et `bossTimeRemaining: 0` si absents

## Contraintes générales

- Ne touche pas au système d'équipement, d'essence, de gemmes, de coffres, ni aux
  sprites du héros déjà intégrés — seule la logique de résolution du combat change
- Même style visuel que le reste, tout en français
- Vérifie la syntaxe des fichiers .js modifiés avant de committer (node --check)
- Une fois terminé, commit + push (le hook PostToolUse s'en charge automatiquement)
