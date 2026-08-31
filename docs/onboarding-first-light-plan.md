# Onboarding « First Light » — plan

## Problème

L'onboarding actuel (7 missions : folder → notebook → save → deck → card →
review → tutor) est fonctionnel mais **lackluster** :

- présenté comme une checklist admin (« Mission 3 of 7 »), pas comme un voyage ;
- il ne couvre **ni Library/Sources, ni le loop Tutor → flashcard draft →
  approbation, ni Progress** — c'est-à-dire la boucle qui différencie Jami
  (work naturally → ask → remember) n'est pas enseignée ;
- aucune narration : le joueur voit une checklist admin, pas un voyage ;
- la métaphore constellation (étoiles gagnées via goals, `ConstellationTrail`,
  `StarRewardOverlay`) existe déjà partout ailleurs mais onboarding l'ignore.

## Concept : « First Light »

**Ton : calme, mystique, pas enfantin.** Pas de points d'exclamation, pas de
« Bravo ! ». L'app chuchote, elle n'applaudit pas.

> *Ton ciel est vide. On va l'allumer — une étoile à la fois.*

Le walkthrough devient un **voyage** : le ciel du student démarre vide, chaque
action réelle allume une étoile. À la fin, l'étudiant n'a pas coché une
checklist — il a **dessiné sa propre constellation**, la même étoile qu'il
gagnera ensuite via les goals. Un seul langage visuel du début à la fin.

## Séquence (8 étapes, ~5–7 min, couvre toute l'app)

**I. A Place to Work**
1. `create-folder` — *Every study needs a home* — créer un folder
2. `create-notebook` — *Open a blank page* — créer un notebook
3. `save-work` — *Leave a mark* — écrire/dessiner, voir la sauvegarde auto
   (moment « it saved itself »)

**II. Bring the World In**
4. `add-source` — *Carry your material* — ajouter une source dans Library
   (upload / coller / notes) — **NOUVEAU**, absent de l'onboarding actuel
5. `ask-tutor` — *Ask, and it answers* — une question au Tutor, hint-first

**III. Remember What Matters**
6. `keep-draft` — *Keep what you learned* — transformer l'échange Tutor en
   flashcard draft et l'approuver — **NOUVEAU**, c'est LA boucle du produit
7. `complete-review` — *See it return* — une review de cette carte
8. `see-sky` — *Look back at your sky* — ouvrir Progress/Constellation et voir
   les étoiles allumées (finale, remplace le « you're done » plat)

~5–7 minutes, chaque surface majeure touchée une fois.

## Présentation

- **Welcome** : « Your sky is empty. Tonight we light it — one star at a
  time. » Le `ConstellationTrail` existant devient le héros (grand, centré),
  silhouette vide qui se remplit au fil des missions.
- **Quest card** : « Chapter II · Bring the World In » en eyebrow, ligne de
  mission en dessous. Mécanique spotlight existante conservée (elle est
  solide : recherche bornée, auto-fade, reduced-motion safe).
- **Micro-célébration** : à chaque mission complétée, une étoile vole de
  l'endroit du travail vers le trail (réutiliser le pattern
  `star-reward-*` à petite échelle, ~1.5 s, pas de spam).
- **Finale** : constellation remplie plein écran → *« This is yours now.
  Every night you study, it grows. »* → handoff vers `/dashboard/constellation`.
- Tout derrière `prefers-reduced-motion` (règle design system).

## Contraintes techniques (respectées)

- **`TUTORIAL_VERSION` → 2** : `normalizeTutorialProgress` reset proprement
  un progrès d'une version inconnue (comportement déjà écrit et testé).
- **`ConstellationTrail` a 7 points fixes** (`POINTS`, `CONSTELLATION_TRAIL_LENGTH=7`
  utilisé aussi par la landing page sign-in) : soit étendre `POINTS` à 8, soit
  garder 7 étoiles visuelles et fusionner 2 missions visuellement. Décision :
  étendre à 8 points (la landing page en montre la forme, pas un compte).
- **Cibles spotlight manquantes** : ajouter `data-tutorial-target="add-source"`
  (Library composer), `keep-draft` (SourceDraftWorkflow / drafts drawer) et
  `see-sky` (Progress/Constellation CTA) — les cibles existantes
  (`create-folder`, `create-notebook`, `save-work`, `create-deck`,
  `create-card`, `complete-review`, `ask-tutor`) restent inchangées.
- **Récompense** : garder `createOnboardingStarIfMissing` et
  `TUTORIAL_VERSION` guard (replay ne re-mint jamais d'étoile).
- Aucune modification de routes, Firebase, study scheduling, tests existants
  (règle « UI-layer only » du design system).

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `lib/onboarding/tutorial.ts` | IDs + copy des missions, `TUTORIAL_VERSION = 2`, type `chapter` sur `TutorialMission` |
| `components/onboarding/TutorialProvider.tsx` | Welcome/finale redesign, chapter label sur quest card, star-fly micro-célébration |
| `app/globals.css` | keyframes `tutorial-star-drift`, `tutorial-fade-in`, backdrop `tutorial-veil` |
| Cibles spotlight | `data-tutorial-target="add-source"` (Library composer), `"keep-draft"` (drafts drawer), `"see-sky"` (CTA Progress/Constellation) |

## Ordre de travail

1. **Pass 1 (pur `lib`, zéro risque visuel)** : missions + copy + version bump
   + tests.
2. **Pass 2 (visuel)** : dialogs + animations, puis browser check du
   walkthrough complet sur un compte vide (desktop + tablet + mobile, empty
   states, reduced-motion).

## Cibles spotlight existantes (inventaire vérifié)

- `create-folder` → `components/workspace/PracticeWorkspace.tsx` (bouton Create folder)
- `create-notebook` → `app/dashboard/folders/[folderId]/page.tsx` (2 occurrences)
- `save-work` → `app/dashboard/notebooks/[notebookId]/page.tsx` (barre de sauvegarde)
- `create-deck` → `app/dashboard/decks/page.tsx`
- `create-card` → `components/decks/CardCreationPanel.tsx`
- `complete-review` → `app/dashboard/study/page.tsx`
- `ask-tutor` → `components/ai/JamiAssistantDrawer.tsx` (reportTutorialAction)

Cibles à ajouter en Pass 2 :
- `add-source` → bouton « Add source » de `app/dashboard/library/page.tsx`
- `keep-draft` → workflow d'approbation des drafts (SourceDraftWorkflow)
- `see-sky` → CTA vers `/dashboard/constellation` (Progress ou page Constellation)
