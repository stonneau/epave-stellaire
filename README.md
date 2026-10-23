# Épave stellaire — prototype web

Clone fan, non officiel, du jeu de plateau **Space Hulk** (Games Workshop), 3e/4e édition, pour jouer entre amis. Tout le mérite du jeu revient à ses auteurs ; ce dépôt ne reproduit ni le livret ni les visuels.

Jouer en ligne : **https://stonneau.github.io/epave-stellaire/**

Mission jouable : **Mission I** (carte reconstituée, proportions approximatives).

## Lancer en local

Site statique, sans build :

```bash
cd hulk
python3 -m http.server 8765
```

puis ouvrir `http://localhost:8765/`.

## Jouer

- **Même écran** : deux joueurs se passent la main. Le joueur Xéno peut afficher le contenu des blips (case dans la légende).
- **En ligne** : « Créer une partie » donne un code ; l'ami choisit « Rejoindre » et le saisit. WebRTC via le broker public de PeerJS, l'hôte fait foi et doit rester connecté. Chaque joueur ne reçoit que sa vue : l'escouade ne voit pas le contenu des blips, les Xénos ne voient pas la valeur des points de commandement.

## Fichiers

- `engine.js` : moteur de règles pur (utilisable dans Node), carte et mission.
- `ui.js` : plateau SVG et panneau d'ordres.
- `net.js` : menus et jeu en ligne.

## Annuler

Bouton « ↶ Annuler » (ou Ctrl+Z) : autant d'annulations qu'on veut pendant son tour, mais pas au-delà d'un jet de dé, d'un blip révélé, d'un nouveau tirage de PC ou du début du tour.

## Écarts connus avec les règles

- Placement des Xénos révélés : l'orientation initiale est choisie automatiquement face au Terminator le plus proche ; en contrepartie, tourner à gauche/droite est gratuit tant que le Xéno n'a pas bougé.
- Parade, garde et relances sont jouées automatiquement au mieux pour l'escouade.
- Une figurine qui traverse une section en flammes meurt sur 2+ à chaque case.
- Pas de tir d'overwatch déclenché par une porte qui se ferme.
- Pas de cadavres ni de cloisons (absents du résumé de règles).
