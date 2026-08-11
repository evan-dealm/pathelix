# RENOMMAGE — projet_clem → pathelix

> Inventaire exhaustif produit avant modifications. État : juin 2026.

---

## Résumé

| Élément | État avant | État après | Action |
|---------|-----------|------------|--------|
| `package.json` `name` | `"pathelix"` | `"pathelix"` | Déjà correct ✅ |
| Dossier git local | `projet_clem/` | `projet_clem/` | Renommage manuel requis (voir §3) |
| Services docker-compose | `postgres/redis/valhalla/worker/app` | idem | Déjà correct ✅ |
| Cache Service Worker | `ef-shell-v1` | `pathelix-shell-v1` | Modifié ✅ |
| Runbook docs/05_EXPLOITATION.md | `ef-redis`, `ef-worker`… | `redis`, `worker`… | Modifié ✅ |
| Runbook docs/INFRASTRUCTURE.md | `ef-redis`, `ef-worker`… | `redis`, `worker`… | Modifié ✅ |
| CI `.github/workflows/ci.yml` | `pathelix:latest` | idem | Déjà correct ✅ |
| `.mcp.json` | `C:\projet_clem` (chemin machine) | — | Hors repo — NE PAS modifier |
| `settings.local.json` | `C:\projet_clem` (chemin machine) | — | Hors repo — NE PAS modifier |
| `typesIntegrity.test.ts` | `EF-456-GH` (immatriculation) | idem | Immatriculation française, pas un préfixe conteneur ✅ |

---

## 1. Occurrences "projet_clem" dans le projet

### Dans les fichiers versionnés (non-machine)

| Fichier | Ligne | Contenu | Action |
|---------|-------|---------|--------|
| `docs/05_EXPLOITATION.md` | 40-45 | Note sur le dossier + `cd projet_clem` | Conservé avec note explicative |
| `JOURNAL_CLAUDE.md` | Session 6 | Mention dans notes de session | Documentation — OK |

### Dans les fichiers machine-spécifiques (hors scope)

| Fichier | Raison de l'exclusion |
|---------|----------------------|
| `.mcp.json` | Fichier de configuration Claude Code local, chemin absolus machine |
| `settings.local.json` | Paramètres Claude Code locaux — chemins absolus machine |

---

## 2. Occurrences "ef-" dans le projet

### ef-* container names — stale (jamais matchés avec docker-compose.yml réel)

Les noms `ef-redis`, `ef-worker`, `ef-postgres`, `ef-valhalla`, `ef-nextjs` n'ont **jamais existé dans le `docker-compose.yml` actuel** (qui utilise les noms courts : `redis`, `worker`, `postgres`, `valhalla`, `app`). Ce sont des noms d'une configuration antérieure qui ne correspond plus.

| Fichier | Ligne | Occurrence | Action |
|---------|-------|------------|--------|
| `docs/05_EXPLOITATION.md` | 277 | `docker-compose restart ef-nextjs` | → `docker compose restart app` |
| `docs/05_EXPLOITATION.md` | 371 | `docker restart ef-redis` | → `docker compose restart redis` |
| `docs/05_EXPLOITATION.md` | 380 | `docker restart ef-worker` | → `docker compose restart worker` |
| `docs/05_EXPLOITATION.md` | 389 | `docker restart ef-postgres` | → `docker compose restart postgres` |
| `docs/05_EXPLOITATION.md` | 398 | `docker restart ef-valhalla` | → `docker compose restart valhalla` |
| `docs/05_EXPLOITATION.md` | 406 | `docker-compose scale ef-worker=3` | → `docker compose up -d --scale worker=3` |
| `docs/INFRASTRUCTURE.md` | 318-322 | `ef-nextjs`, `ef-worker`, `ef-ai-engine` | → `app`, `worker`, ROADMAP |
| `docs/INFRASTRUCTURE.md` | 347-382 | Runbook complet avec `ef-*` | Corrigé en service names réels |
| `public/sw.js` | 9 | `CACHE_NAME = 'ef-shell-v1'` | → `'pathelix-shell-v1'` |

### ef- utilisé légitimement (NE PAS modifier)

| Fichier | Occurrence | Raison |
|---------|------------|--------|
| `src/lib/__tests__/typesIntegrity.test.ts` | `licensePlate: 'EF-456-GH'` | Format d'immatriculation française valide — pas un préfixe conteneur |

---

## 3. Renommage du dossier git (action manuelle requise)

Le dossier `C:\projet_clem` doit être renommé manuellement. Git ne track pas le nom du dossier racine.

**Procédure (à exécuter en dehors de Claude Code) :**

```powershell
# 1. Arrêter tous les processus utilisant le dossier
# 2. Renommer le dossier
Rename-Item -Path "C:\projet_clem" -NewName "pathelix"
# 3. Mettre à jour les références locales Claude Code
# (.mcp.json, settings.local.json) — ces fichiers sont machine-spécifiques
# 4. Recommencer Claude Code dans le nouveau dossier
```

**Impact du renommage dossier :**
- Chemins absolus dans `.mcp.json` et `settings.local.json` → à mettre à jour manuellement
- Remote Git (GitHub/GitLab) : le repo distant n'est pas affecté (le dossier local est indépendant)
- CI/CD : aucun impact (utilise le repo distant, pas le chemin local)
- docker-compose bind-mounts : aucun impact (les volumes sont nommés, pas des bind-mounts absolus)
- Variables `DATABASE_URL` en dev : aucun impact
- `npm run *` : aucun impact

---

## 4. État post-modification

Après application des changements :
- **Zéro occurrence `ef-`** dans le code source et les docs, sauf `EF-456-GH` (immatriculation)
- **Zéro occurrence `projet_clem`** dans les docs (sauf dans RENOMMAGE.md et JOURNAL.md comme trace historique)
- **Cohérence totale** : les noms de services dans le runbook matchent exactement les noms dans `docker-compose.yml`
