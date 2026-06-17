# Feuille de route IA — Pathélix

> État actuel et prochaines étapes des modules IA/ML.
> Statut vérifié contre le code réel — rien n'est marqué déployé sans que le code existe.

---

## Résumé des statuts

| Module | Statut | Emplacement du code |
|--------|--------|---------------------|
| **Prédiction ML de durée** | ✅ Déployé | `src/lib/metricCollector.ts`, `src/workers/mlProfileWorker.ts` |
| **Saisie de mission en langage naturel** | 🔶 Partiel | `src/app/api/missions/parse-natural/route.ts`, `src/components/driver/NaturalMissionInput.tsx` |
| **Smart Scan OCR** | 🔶 Python construit, non intégré | `ai-engine/app/workers/ocr_worker.py` — les routes Next.js `/api/ai/*` n'existent PAS |
| **Copilot Planificateur** | ❌ Non démarré | Aucun code n'existe |

GPU cloud requis : 12 Go VRAM minimum pour les modules OCR et Copilot.

---

## 1. Prédiction ML de durée — ✅ Déployé

CPU uniquement, 100 % Node.js, aucun GPU requis.

### Ce que ça fait

Corrige les estimations de durée de mission avec les données terrain réelles collectées à chaque mission terminée.

### Composants

| Fichier | Rôle |
|---------|------|
| `src/lib/metricCollector.ts` | Phase 1 : enregistre les durées réelles de trajet / manœuvre / intervention après chaque mission |
| `src/workers/mlProfileWorker.ts` | Phase 2 : CRON nocturne (02:30) recalcule les coefficients par tenant via médiane tronquée P10–P90 |
| `src/lib/mlCoefficients.ts` | Phase 3 : applique les coefficients avant chaque optimisation VRP |
| `prisma/schema.prisma` | Modèles `InterventionMetric` + `TenantMLProfile` |
| `src/app/api/superadmin/ml-status/` | Tableau de bord de maturité ML par tenant |

### 3 boucliers qualité

1. Clic trop rapide (< 10s entre deux étapes) → REJETÉ
2. Durée aberrante (> 4× la durée attendue) → REJETÉ
3. GPS incohérent (0 min de trajet, delta GPS significatif) → REJETÉ

Voir [docs/ALGORITHM.md](ALGORITHM.md#11-système-ml-3-phases) pour la spécification complète.

---

## 2. Saisie de mission en langage naturel — 🔶 Partiel

### Ce qui existe

- `POST /api/missions/parse-natural` — route API qui appelle une instance Ollama locale pour parser une description en texte libre en mission structurée
- `src/components/driver/NaturalMissionInput.tsx` — composant UI de saisie textuelle sur l'interface chauffeur

### Ce qui manque

- Ollama doit tourner sur le serveur cloud (`http://localhost:11434` par défaut)
- Aucun conteneur Docker ni configuration pour Ollama n'est inclus dans les fichiers Docker Compose actuels
- Aucun repli si Ollama est indisponible — la route retourne une erreur

### Pour finaliser

1. Ajouter le conteneur Ollama dans `docker-compose.ai.yml`
2. Ajouter la variable d'environnement `OLLAMA_URL` à la configuration documentée
3. Tester avec de vraies descriptions de missions en français
4. Ajouter un repli gracieux si Ollama est inaccessible (retourner une erreur structurée, pas un crash)

---

## 3. Smart Scan OCR — 🔶 Python construit, Next.js non intégré

### Ce qui existe

**AI Engine Python (construit, non connecté) :**

| Fichier | Rôle |
|---------|------|
| `ai-engine/app/main.py` | App FastAPI + consommateur de file Redis BRPOP |
| `ai-engine/app/workers/ocr_worker.py` | Worker OCR Donut — charge le modèle, lance l'inférence, envoie le callback HMAC |
| `ai-engine/app/model_manager.py` | Arbitre VRAM — un seul modèle en VRAM à la fois, échange séquentiel |
| `ai-engine/app/config.py` | Configuration URL Redis, nom de file, URL de callback |
| `ai-engine/app/routes/health.py` | `GET /health` — statut VRAM GPU |

**Ce que fait le côté Python :**
1. Écoute sur la file Redis `ai-jobs:pending` (boucle BRPOP)
2. Sur job de type `"ocr"` : charge Donut (`naver-clova-ix/donut-base`), prétraite l'image, lance l'inférence
3. POST du résultat vers l'URL de callback avec signature HMAC-SHA256

### Ce qui manque

**Intégration Next.js (rien n'existe) :**
- `POST /api/ai/ocr` — soumettre une image pour OCR
- `POST /api/ai/callback` — recevoir le résultat de l'AI Engine (vérifié HMAC)
- `GET /api/ai/jobs` — lister les jobs IA du tenant
- `GET /api/ai/jobs/[id]` — statut d'un job
- Modèle `AiJob` dans `prisma/schema.prisma`
- Bouton "Scanner le ticket" sur l'interface chauffeur (après complétion d'une mission VIDER)
- Affichage du poids sur la carte mission (vue planificateur)

### Architecture

```
Next.js (cloud)                        AI Engine (Python, même serveur)
  POST /api/ai/ocr                       FastAPI + consommateur BRPOP
    → LPUSH ai-jobs:pending ──bridge──▶  ocr_worker.py (Donut GPU)
    ← 202 { jobId }                         ↓
                                           POST /api/ai/callback ──▶ Next.js
                                           (signé HMAC, AI_CALLBACK_SECRET)
```

### À implémenter

**Phase 1 — Base de données + squelette API (1 jour) :**
```
□ Ajouter AiJob à prisma/schema.prisma + migrer
□ POST /api/ai/ocr  — valider l'entrée, LPUSH vers Redis, retourner 202
□ POST /api/ai/callback — vérifier HMAC, mettre à jour AiJob, notifier via SSE
□ GET  /api/ai/jobs, GET /api/ai/jobs/[id]
□ Ajouter AI_ENGINE_URL, AI_CALLBACK_SECRET à la documentation env
```

**Phase 2 — UI chauffeur (1 jour) :**
```
□ Bouton "Scanner le ticket" sur l'interface chauffeur (après complétion VIDER)
□ Afficher les poids extraits sur la carte mission (badge de confiance)
□ Correction manuelle si confiance < 0,80
```

**Phase 3 — Déploiement (1 jour) :**
```
□ Ajouter ai-engine à docker-compose.ai.yml (déjà ébauché dans les anciennes docs)
□ Ajouter le conteneur Ollama pour parse-natural
□ Configurer le runtime NVIDIA sur le serveur cloud (nvidia-container-toolkit)
□ Collecter 200+ vraies photos de tickets pour le fine-tuning de Donut
□ Intégrer la santé de l'AI Engine dans GET /api/health
```

### Schéma AiJob (à ajouter dans prisma/schema.prisma)

```prisma
model AiJob {
  id          String    @id @default(cuid())
  tenantId    String
  type        String    // "ocr"
  status      String    @default("queued") // queued | processing | completed | failed
  inputPath   String?
  result      Json?
  error       String?
  missionId   String?
  createdBy   String
  createdAt   DateTime  @default(now())
  completedAt DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@index([tenantId, createdAt(sort: Desc)])
}
```

### Objectifs de performance

| Métrique | Cible |
|----------|-------|
| Latence OCR P95 | < 5s |
| Précision OCR (extraction poids) | > 95 % |
| Profondeur de file max | < 10 jobs |
| Temps de swap VRAM | < 3s |

---

## 4. Copilot Planificateur — ❌ Non démarré

### Concept

Le planificateur tape une question en français. Le LLM identifie l'intention et les paramètres. Next.js exécute un handler Prisma pré-codé (pas de génération SQL libre — évite les injections et les hallucinations).

### Ressources GPU disponibles

GPU cloud : 12 Go VRAM minimum. Donut OCR utilise ~3 Go, Llama 3 8B Q4 utilise ~6 Go. L'arbitre VRAM dans `model_manager.py` gère déjà l'échange séquentiel, mais le Copilot nécessiterait d'ajouter le support Llama (branche `_load("copilot")`).

### Intentions prévues (V1)

| Intention | Type de requête |
|-----------|----------------|
| `find_driver` | Chauffeur disponible près d'une position avec une taille de benne |
| `mission_status` | Statut des missions d'un chauffeur |
| `daily_stats` | Comptes de missions et retards du jour |
| `find_mission` | Trouver une mission par client / adresse / type |
| `driver_eta` | Heure d'arrivée estimée d'un chauffeur |

### Architecture

```
Planificateur tape : "Qui est disponible près de Lyon avec une benne de 15m³ ?"
      │
      ▼ POST /api/ai/ask → Redis ai-jobs:pending
      │
      ▼ (Docker bridge → Ollama sur le serveur cloud)
  Llama 3 8B classifie l'intention + extrait les paramètres → JSON
      │
      ▼ callback → Next.js
  Handler Prisma : findAvailableDriverNear({ binSize: 15, location: "Lyon" })
      │
      ▼ Réponse formatée en français → UI planificateur
```

### À implémenter

```
□ Étendre model_manager.py pour supporter le modèle "copilot" (Llama 3 via Ollama HTTP)
□ Ajouter copilot_worker.py (appel Ollama, parsing JSON, callback)
□ Ajouter la route POST /api/ai/ask dans Next.js
□ Implémenter les 5 handlers Prisma (un par intention)
□ UI chat : barre fixe en bas du tableau de bord admin
□ Affinage du prompt système avec 50+ vraies questions de planificateur
```

---

## 5. Gestion des ressources GPU

L'arbitre VRAM (`ai-engine/app/model_manager.py`) garantit qu'un seul modèle est en VRAM à la fois :

| Scénario | VRAM utilisée | Faisable ? |
|----------|--------------|------------|
| OCR seul | ~3 Go | ✅ 9 Go libres |
| Copilot seul (Ollama) | ~6 Go | ✅ 6 Go libres |
| OCR + Copilot simultanément | ~9 Go | ⚠️ Serré — l'arbitre met l'OCR en file jusqu'à ce qu'Ollama libère la VRAM |

Ollama gère Llama dans un processus séparé. L'arbitre gère Donut. Quand les deux sont nécessaires simultanément, l'arbitre attend qu'Ollama libère la VRAM avant de charger Donut.

---

## 6. Sécurité

| Aspect | Implémentation |
|--------|----------------|
| Images | Stockées par `tenantId` — accès inter-tenant impossible |
| Webhook de callback | Vérifié par `AI_CALLBACK_SECRET` (HMAC-SHA256 dans l'en-tête) |
| Copilot | Ne génère jamais de SQL — uniquement des handlers Prisma pré-codés |
| Audit | Chaque résultat IA journalisé avec le tag `ai:ocr` ou `ai:copilot` |
| RGPD | Images supprimées après 30 jours, aucun appel à une API externe |
| Isolation DB | Le Worker Python accède à PostgreSQL uniquement via le callback VPS — pas de connexion directe à la DB |
