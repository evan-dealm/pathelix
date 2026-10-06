# Pathélix — Fonctionnalités

Ce que fait l'application, par profil, et comment elle s'intègre au reste du système
d'information. Référence API interactive : `/api-docs` (spécification `/api/docs`).

## 1. Exploitant et administrateur — `/admin`

Les onglets et actions visibles dépendent du rôle et des permissions (SECURITY.md §3).

**Tableau de bord** — indicateurs du jour (missions en attente, chauffeurs planifiés, urgences
P1, distance, temps moyen, non affectées ; carburant estimé avec « Voir les coûts »), alertes,
carte de la flotte.

**Missions** — liste filtrable (date, type, priorité, chauffeur, statut) en tableau ou Kanban ;
création, modification, archivage, actions groupées ; preuves de livraison ; import CSV/JSON,
export CSV/Excel ; saisie en langage naturel (si Ollama est configuré).

**Tournées** — plan du jour par chauffeur (carte, liste ordonnée, Gantt) :
- optimisation de toute la journée (asynchrone, résultat poussé en direct) ;
- ré-optimisation en cours de journée depuis la position réelle des chauffeurs, sans toucher
  aux arrêts faits ;
- reséquencement d'un chauffeur, redistribution entre chauffeurs, glisser-déposer, verrouillage ;
- missions non affectées et avertissements expliqués (capacité, horaires, benne trop grande…) ;
- annuler / rétablir ; feuilles de route PDF et CSV ; coûts par tournée (carburant, péages,
  usure — permission « Voir les coûts ») ; lien de suivi client par mission.

**Planning semaine** — optimisation sur plusieurs jours.

**Statistiques** — performance par chauffeur et secteur ; **rapport mensuel PDF** et **bilan
CO₂** (permission « Voir les rapports »).

**Historique** — tournées passées, enregistrement de la tournée courante.

**Catalogue** — clients, sites géolocalisés (accès, contraintes), produits par site.

**Chauffeurs** — fiche, compétences, dépôt, indisponibilités, conformité (heures), photo.
**Camions** — gabarit (poids, dimensions, essieux, matières dangereuses), capacité en bennes ou
m³, entretiens, carburant. **Exutoires** — horaires, jours de fermeture, déchets acceptés, temps
de service. **Récurrentes** — modèles générant les missions automatiquement.

**Utilisateurs** — comptes admin/exploitant/chauffeur, permissions fines, réinitialisation de
mot de passe (révoque les sessions). **Audit** — journal filtrable des opérations sensibles.
**Télématique** — positions en direct (application ou boîtiers).

**Paramètres** — secteur d'activité (vocabulaire), heure de départ, vitesse, pondérations de
l'optimiseur (distance, ponctualité, équilibre, stabilité), jours fériés, branding, sauvegarde
JSON, notifications, facturation ; **Intégrations** ; **Accès API** (création de clés à scopes,
dernière utilisation, révocation).

## 2. Chauffeur — `/driver/<id>`

Application mobile, utilisable sans réseau :
- tournée du jour ordonnée, ETA, P1 en évidence, itinéraire ouvert dans l'application de
  navigation ;
- statuts « En route → Sur place → Terminé », photos, signature, commentaire, incident ;
- poids du ticket de pesée, saisi ou lu par photo (si l'AI Engine OCR est déployé) ;
- tout est enregistré hors connexion et envoyé au retour du réseau, sans doublon ;
- position GPS envoyée toutes les 30 s ; notifications push.

## 3. Superadmin — `/superadmin`

Organisations (création, suspension, purge de cache, impersonation journalisée), utilisateurs
toutes organisations, secteurs personnalisés, santé du système, maturité ML, audit transverse,
offres.

## 4. Pages publiques

| URL | Contenu |
|---|---|
| `/` | Présentation du produit (redirige un utilisateur connecté vers son espace) |
| `/login` | Connexion |
| `/track/<jeton>` | Suivi d'une intervention par le client final (lien à durée limitée) |
| `/status` | État du service |
| `/help` | Aide et FAQ |
| `/onboarding` | Choix du secteur à la première connexion d'un admin |

## 5. Optimisation — ce que l'optimiseur respecte

Fenêtres horaires ; priorités (P1 servies avant leur échéance, affectées en dernier recours) ;
capacité de chaque camion en bennes, passages à l'exutoire quand le camion est plein ou après la
dernière benne ; horaires et déchets acceptés des exutoires ; taille de benne compatible avec le
camion ; compétences requises ; dépendances entre missions ; exclusivité des allers-retours ;
temps de conduite et pauses CE 561/2006 ; durée de travail ; pause déjeuner ; équilibre de charge ;
familiarité chauffeur × site. Durées et temps de trajet corrigés par les coefficients appris.
Détails : ARCHITECTURE.md §4.

## 6. API et intégrations

**API REST** — authentification par clé (`X-API-Key`, scopes : missions, chauffeurs, véhicules,
clients, sites, tournées en lecture/écriture ; optimisation ; rapports). Exemple :

```bash
curl -H "X-API-Key: ef_live_…" "https://<hôte>/api/missions?date=2026-10-06"
curl -X POST -H "X-API-Key: ef_live_…" -H "Content-Type: application/json" \
     -d '{"date":"2026-10-07"}' https://<hôte>/api/optimize      # → jobId, puis GET /api/optimize/<jobId>
```

**Webhooks entrants** (secret par organisation, configuré dans Intégrations) :

| Source | Route | Authentification | Effet |
|---|---|---|---|
| Nessy (ERP) | `POST /api/webhooks/nessy` | HMAC-SHA256 `x-nessy-signature`, `sentAt` ≤ 5 min | Missions créées (≤ 500 par lot, dédupliquées) |
| Boîtier OBD | `POST /api/webhooks/obd` | `Authorization: Bearer` | Positions |
| Geotab, Samsara | `POST /api/webhooks/geotab`, `/samsara` | Clé | Positions, télématique |
| Trackdéchets | `POST /api/webhooks/trackdechets` | HMAC | Statut des bordereaux |
| AI Engine | `POST /api/ai/callback` | HMAC `x-ai-signature` | Résultat OCR |

**Sorties** — facturation Sage / SAP à la fin d'une mission, notifications Slack/Teams, SMS
Twilio au client, indicateurs Power BI, webhook personnalisé signé HMAC ; routage Trimble/HERE ;
**Trackdéchets** (bordereaux, signatures — production bloquée tant que la procédure
d'OPERATIONS.md §8 n'est pas validée).

## 7. Limites connues

- Interface en français uniquement (`next-intl` installé, non câblé).
- OCR des tickets : nécessite le déploiement de l'AI Engine (non fourni dans le compose).
- Le poids total transporté (PTAC) n'est pas contraint, seul le volume des bennes l'est.
- Saisie en langage naturel : indisponible sans Ollama.
- Temps de conduite : le calcul remet le compteur de conduite continue à zéro après un passage
  à l'exutoire (déchargement), alors que le règlement CE 561/2006 n'assimile pas un arrêt de
  15–20 min à une pause de 45 min. Les tournées très longues avec vidages peuvent donc sous-estimer
  une pause ; le contrôle final reste celui du chronotachygraphe.
