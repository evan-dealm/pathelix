# OFFLINE_AUDIT.md — Pathélix mode hors-ligne

> Audit de l'implémentation offline. Produit en session 8 (2026-06-19).  
> Portée : Service Worker, IndexedDB, syncQueue, hooks, UI d'état.

---

## 1. Cartographie de l'implémentation

### 1.1 Service Worker (`public/sw.js`)

| Élément | État |
|---------|------|
| Cache shell | `pathelix-shell-v1`, pre-cache `['/',''/driver']` |
| Stratégie | Cache-first pour le shell, network-first pour les API |
| Background Sync | Tag `flush-offline-queue` — traite les clés IDB triées lexicographiquement |
| Réponse 5xx | `break` — stop le flush, garde l'action en file |
| Réponse 422 | Succès idempotent — supprime l'action |
| `retryCount` SW | **NON incrémenté** — contrairement au flush client |
| Import idb-keyval | Impossible dans SW (raw IDB API utilisée) |

### 1.2 IndexedDB / idbStorage

| Fichier | Rôle |
|---------|------|
| `src/lib/idbStorage.ts` | Zustand StateStorage adapter (IDB primary, localStorage fallback) |
| `idb-keyval` | Clé/valeur IDB — utilisé par syncQueue |
| Préfixe sync | `sync-q:` |
| TTL plan journée | 24h (`getCachedDayPlan`) |

### 1.3 syncQueue (`src/lib/syncQueue.ts`)

| Élément | État |
|---------|------|
| `enqueueAction(url, body)` | Ajoute à IDB, déclenche BG Sync |
| `flushSyncQueue()` | Traite en ordre chronologique (`timestamp`), incrémente `retryCount` |
| `MAX_RETRIES` | 5 — action supprimée si dépassé |
| Verrou de flush | **AJOUTÉ** — `_flushInProgress` module-level (fix session 8) |
| Traitement 422 | Succès (idempotence serveur) |
| `getSyncQueueSize()` | Compte les clés `sync-q:` |

### 1.4 SWProvider (`src/providers/SWProvider.tsx`)

```typescript
const handleOnline = async () => {
  const { flushSyncQueue } = await import('@/lib/syncQueue')
  await flushSyncQueue()  // désormais protégé par _flushInProgress
}
window.addEventListener('online', handleOnline)
```

### 1.5 Page chauffeur (`src/app/driver/[id]/page.tsx`)

| Action | Mécanisme | État |
|--------|-----------|------|
| Avance de statut mission | `enqueueAction('/api/driver-status/update', payload)` | ✅ queued |
| GPS buffer | `enqueueAction('/api/gps-track', payload)` | ✅ queued |
| Photo | `fetch('/api/driver-photos', ...)` direct | ⚠️ risque perte |
| Commentaire incident | `enqueueAction(...)` | ✅ queued |
| Plan journée cache | `cacheDayPlan` / `getCachedDayPlan` (24h TTL) | ✅ |
| Verrou local | `syncLock.current` — protège uniquement `syncNow()` de la page | note ci-dessous |

### 1.6 OfflineBanner / indicateur d'état

Pas de composant `OfflineBanner` indépendant. L'état hors-ligne est affiché directement dans le header de la page chauffeur via `isOnline` state + compteur `pendingSync`.

---

## 2. Risques identifiés

### R1 — Flush concurrent SWProvider + page (CRITIQUE) ✅ CORRIGÉ

**Avant fix** : `SWProvider.handleOnline` et `DriverPage.syncNow` appelaient tous deux `flushSyncQueue()` simultanément sur l'événement `online`. Le verrou `syncLock.current` de la page ne protégeait pas contre SWProvider.

**Fix** : Verrou module-level `_flushInProgress` dans `syncQueue.ts`. Tout appel concurrent retourne 0 immédiatement.

**Tests** : `flushSyncQueue — advanced scenarios > prevents concurrent flushes` ✅

---

### R2 — Photos perdues hors-ligne (RISQUE CONNU, NON CORRIGÉ)

`handlePhoto` dans `driver/[id]/page.tsx` utilise `fetch()` direct, pas `enqueueAction`. Si le réseau est absent au moment de l'upload, la photo est silencieusement perdue.

**Pourquoi non corrigé** : L'API `/api/driver-photos` reçoit un `FormData` multipart (binaire). `enqueueAction` sérialise en JSON — incompatible sans refonte du format de stockage IDB + endpoint. Scope trop large pour ce sprint.

**Mitigation actuelle** : L'interface UI devrait afficher une erreur visible si `fetch` échoue hors-ligne. À ajouter.

**À faire** : Issue P2 — stocker photos en IDB (base64) + replay sur reconnexion.

---

### R3 — Divergence retryCount SW vs client (MINEUR)

Le Background Sync du SW (`public/sw.js`) ne lit ni n'incrémente `retryCount`. Il stoppe sur 5xx mais ne purge pas les actions épuisées. La purge des `retryCount >= MAX_RETRIES` est faite uniquement par `flushSyncQueue` côté client.

**Impact** : Si le SW traite la file sans passer par le client, les actions épuisées restent indéfiniment. En pratique, le SW est un fallback — le client flush en priorité à la reconnexion. Risque faible.

---

### R4 — Tri SW lexicographique vs chronologique client

Le SW trie les clés IDB lexicographiquement (ordre alphabétique des strings `sync-q:TIMESTAMP-RANDOM`). Le client trie par `timestamp`. Comme le préfixe est `sync-q:` suivi du timestamp en ms, l'ordre lexicographique correspond à l'ordre chronologique pour les timestamps de même longueur (13 chiffres jusqu'à ~2286). Pas de risque réel.

---

### R5 — Pas de gestion de conflit serveur

Si un statut envoyé hors-ligne est refusé par le serveur (4xx non-422), l'action reste en file, `retryCount` n'est pas incrémenté, et le cycle recommence indéfiniment. En pratique les 4xx légitimes devraient être 422 (idempotence) ou 400 (validation). Risque faible mais non nul.

---

## 3. Couverture de tests

### Tests unitaires ajoutés (session 8)

| Scénario | Fichier | Statut |
|----------|---------|--------|
| Flush concurrent — second call retourne 0 | `syncQueue.test.ts` | ✅ |
| Retry count épuisé → delete sans fetch | `syncQueue.test.ts` | ✅ |
| Échec partiel — 1er OK, 2e KO | `syncQueue.test.ts` | ✅ |
| Incrément retryCount sur 5xx | `syncQueue.test.ts` | ✅ |
| Ordre chronologique garanti | `syncQueue.test.ts` | ✅ |

### E2E (Playwright)

Fichier : `e2e/offline-driver.spec.ts` (ajouté session 8)  
Scénarios : go offline → avancer statut → go online → vérifier sync.

### Non testés

- Photo upload hors-ligne (risque R2 — scope trop large)
- Persistance IDB après rechargement de page (nécessite vrai navigateur)
- Conflit serveur (4xx non-422) — edge case faible

---

## 4. État global : ce qui fonctionne, ce qui ne fonctionne pas

| Fonctionnalité | État |
|---------------|------|
| Avance de statut mission hors-ligne | ✅ queued + synced |
| Cache du plan journée (24h) | ✅ |
| GPS buffer hors-ligne | ✅ queued |
| Commentaire / incident hors-ligne | ✅ queued |
| Photo hors-ligne | ❌ perte silencieuse (R2) |
| Signature hors-ligne | À vérifier (utilise-t-elle `enqueueAction` ?) |
| Indicateur hors-ligne (header) | ✅ `isOnline` + `pendingSync` count |
| Composant OfflineBanner standalone | Absent — intégré à la page driver |
| SW background sync | ✅ (tag `flush-offline-queue`) |
| Flush concurrent sécurisé | ✅ (fix session 8) |
| Idempotence (422 = succès) | ✅ |
| Retry cap (MAX_RETRIES=5) | ✅ côté client |
| Multi-langue | Infra next-intl présente, `useTranslations()` jamais appelé (0 occurrence) |

---

## 5. Risques restants par priorité

| Prio | Risque | Action recommandée |
|------|--------|--------------------|
| P2 | R2 — Photos perdues offline | Stocker en IDB base64 + replay endpoint dédié |
| P3 | R3 — SW retryCount divergence | Synchroniser SW avec même logique MAX_RETRIES |
| P4 | R5 — Conflit serveur 4xx non-422 | Définir politique : purge immédiate ou alerte UI |
| P5 | Signature offline non confirmée | Auditer `handleSignature` dans driver page |
