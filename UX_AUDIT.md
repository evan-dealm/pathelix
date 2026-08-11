# UX_AUDIT.md — Pathélix : prise en main en 10 minutes

> Audit UX pour permettre à un non-technicien de comprendre et utiliser l'application  
> sans assistance. Produit en session 8 (2026-06-19). Règle absolue : **AJOUTER de la  
> simplicité, ne JAMAIS retirer une fonctionnalité**.

---

## 1. Méthode d'audit

Parcours point par point des écrans principaux en mode "nouvel arrivant" :  
admin page → pages driver → pages superadmin → page aide.

---

## 2. Points de friction identifiés par écran

### 2.1 Page Admin (`/admin`)

| # | Friction | Sévérité | Traitement |
|---|----------|----------|------------|
| A1 | Aucun guide au premier login — 13 onglets sans explication | Haute | ✅ OnboardingGuide ajouté |
| A2 | Jargon métier : "Exutoire", "VIDER", "ALLER_RETOUR", "valhallaFactor" sans explication | Haute | → Infobulles (P2) |
| A3 | Onglets sans titre de section groupée — ordre non intuitif pour débutant | Moyenne | → Groupement visuel (P2) |
| A4 | Bouton "Optimiser" disponible même quand liste missions vide → erreur confuse | Moyenne | → EmptyState + désactivation bouton (P2) |
| A5 | Messages d'erreur API génériques ("Erreur serveur") | Basse | Existant, contexte manque |
| A6 | Import CSV : mapping colonnes "automatique" mais aucun feedback sur erreurs de colonnes | Moyenne | Existant |

### 2.2 Page Chauffeur (`/driver/[id]`)

| # | Friction | Sévérité | Traitement |
|---|----------|----------|------------|
| D1 | Boutons statut petits pour usage tactile mobile | Haute | → Taille min 44px (P1) |
| D2 | Aucun guide à la première connexion | Haute | → OnboardingGuide mode driver (P2) |
| D3 | Indicateur hors-ligne affiché mais sans explication que les données sont sauvegardées | Moyenne | → Texte rassurant (P2) |
| D4 | Signature et photo : aucun feedback si réseau absent | Haute | → Toast d'avertissement (P2 - photo non queued, R2 de OFFLINE_AUDIT) |
| D5 | Plan vide → affichage vide sans message | Moyenne | → EmptyState (P2) |

### 2.3 Pages Superadmin (`/superadmin/*`)

| # | Friction | Sévérité | Traitement |
|---|----------|----------|------------|
| S1 | Tableaux sans état vide explicite | Basse | → EmptyState (P3) |
| S2 | Actions destructives (suppression tenant) sans confirmation notable | Haute | Déjà présent (modal existant) |
| S3 | "valhallaFactor 1.60" sans unité ni explication | Moyenne | → Infobulle (P2) |

### 2.4 Page Aide (`/help`)

| # | Friction | Sévérité | Traitement |
|---|----------|----------|------------|
| H1 | FAQ sans lien vers guide de démarrage interactif | Haute | ✅ Bouton "Guide de démarrage" ajouté |
| H2 | Accents manquants dans certaines questions | Basse | Non bloquant |

---

## 3. Patterns implémentés (session 8)

### 3.1 Onboarding guidé — `OnboardingGuide`

**Fichier** : `src/components/ui/OnboardingGuide.tsx`  
**Tests** : `src/components/ui/__tests__/OnboardingGuide.test.tsx` (13 tests ✅)

- S'affiche automatiquement à la première visite (localStorage `pathelix-onboarding-v1`)
- 4 étapes admin / 3 étapes chauffeur
- Navigation avant/arrière + "Passer"
- Rejouable depuis la page Aide
- `forceShow` prop pour déclenchement programmatique
- `resetOnboarding()` exposé pour replay
- Câblé dans : `/admin/page.tsx`, `/help/page.tsx`

### 3.2 EmptyState — `EmptyState`

**Fichier** : `src/components/ui/EmptyState.tsx`  
**Tests** : `src/components/ui/__tests__/EmptyState.test.tsx` (9 tests ✅)

- Composant réutilisable : icône + titre + description + bouton CTA
- `role="status"` pour accessibilité
- À câbler dans : tabs Drivers, Missions, Tours, Exutoires quand liste vide

---

## 4. Accessibilité (état actuel + gaps)

| Critère | État |
|---------|------|
| Contraste texte/fond | Palette Geist — généralement bon mais non audité WCAG AA |
| Cibles tactiles (44×44px minimum) | Boutons principaux OK, boutons statut driver < 44px |
| Navigation clavier | Partielle — modals piégent focus, onglets admin non tabulables |
| Labels ARIA | Boutons icône sans `aria-label` dans certains endroits |
| `role="dialog"` sur modals | Présent dans OnboardingGuide, vérifier modals existants |
| `aria-modal="true"` | Ajouté dans OnboardingGuide |

---

## 5. Infobulles jargon (à implémenter — P2)

Termes prioritaires à expliquer via tooltip au survol :

| Terme | Explication courte |
|-------|--------------------|
| Exutoire | Point de dépôt/vidage où la benne est déchargée |
| VIDER | Mission synthétique générée automatiquement par l'optimiseur |
| PAUSE | Pause légale CE 561/2006 insérée automatiquement |
| P1 / P2 / P3 | Priorité de mission : P1 = urgent avant 10h |
| valhallaFactor | Facteur de correction ML du temps de trajet (défaut 1.60 = +60%) |
| MV-ALNS | Algorithme d'optimisation interne (pas besoin de l'expliquer) |
| CVaR | Mesure de risque dans l'optimiseur (idem — masquer) |

---

## 6. Chemins principaux (golden paths)

### Chemin admin — créer et optimiser une tournée

1. Login → Onglet "Chauffeurs" → Ajouter chauffeur
2. Onglet "Missions" → Ajouter missions ou importer CSV
3. Onglet "Tournées" → Sélectionner date → Optimiser
4. Valider les tournées → Les chauffeurs voient leur plan

**Points de blocage** : étape 1-2 sans guide = confusion si onglets non évidents.  
**Fix** : OnboardingGuide couvre les étapes 1-3.

### Chemin chauffeur — réaliser une mission

1. Login → Plan du jour s'affiche
2. Appuyer sur mission → Démarrer
3. Avancer les statuts (En route → Arrivé → Terminé)
4. Réseau absent → même parcours (sync différée)

**Points de blocage** : petits boutons D1, pas de guide D2.

---

## 7. Roadmap UX (hors scope session 8 — à traiter)

| Prio | Item | Effort |
|------|------|--------|
| P1 | Boutons statut chauffeur : taille min 44px | S |
| P2 | Toast d'avertissement photo offline (D4) | S |
| P2 | Infobulles jargon (Tooltip component) | M |
| P2 | EmptyState câblé dans tabs admin | S |
| P2 | OnboardingGuide mode driver câblé dans `/driver/[id]` | S |
| P3 | Groupement onglets admin par catégorie | M |
| P3 | Labels ARIA sur boutons icône | S |
| P4 | Audit WCAG AA complet | L |
