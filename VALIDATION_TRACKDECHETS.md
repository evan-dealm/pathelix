# VALIDATION_TRACKDECHETS.md

> Statut : HALT en vigueur — ne basculer vers le sandbox réel qu'après validation humaine de cette checklist.

## 1. Champs obligatoires par étape

### Création du BSDD (`POST /api/bsds`)
Validés par `BsddCreateSchema` (Zod) avant tout appel TD :

| Champ | Validation |
|-------|-----------|
| `emitter.company.siret` | 14 chiffres exactement (`/^\d{14}$/`) |
| `emitter.company.name` | `string.min(1)` |
| `emitter.company.address` | `string.min(1)` |
| `recipient.processingOperation` | Pattern `[DR]\d+` (ex: D9, R1) |
| `recipient.company.siret` | 14 chiffres |
| `recipient.company.name` | `string.min(1)` |
| `recipient.company.address` | `string.min(1)` |
| `wasteDetails.code` | `string.min(2)` |
| `emitter.company.mail` | Email valide OU chaîne vide |
| `transporter.department` | Pattern `\d{2,3}` si présent |

Champs optionnels à la création mais requis aux étapes suivantes — voir ci-dessous.

### Signature producteur (`POST /api/bsds/[id]/sign` — `signatureType: 'PRODUCER'`)
Contrôlés par `validatePayloadForProducerSign(bsd.payload)` **avant** l'appel TD :

| Champ | Message d'erreur exact retourné si absent |
|-------|------------------------------------------|
| `wasteDetails.name` | `wasteDetails.name — nom commercial du déchet requis à la signature producteur` |
| `wasteDetails.quantity` | `wasteDetails.quantity — quantité requise à la signature producteur` |

### Signature transporteur (`POST /api/bsds/[id]/sign` — `signatureType: 'TRANSPORTER'`)
Contrôlés par `validatePayloadForTransporterSign(bsd.payload)` **avant** l'appel TD :

| Champ | Message d'erreur exact retourné si absent |
|-------|------------------------------------------|
| `transporter` (bloc) | `transporter — bloc transporteur requis pour la signature transporteur` |
| `transporter.receipt` | `transporter.receipt — récépissé transporteur requis` |
| `transporter.department` | `transporter.department — département transporteur requis` |
| `transporter.validityLimit` | `transporter.validityLimit — date de validité du récépissé requise` |

Sur erreur de pré-validation, la route retourne :
```json
HTTP 422
{ "error": "Données manquantes pour la signature", "fields": ["<field> — <explication>", ...] }
```
L'appel TD n'est **jamais** effectué.

---

## 2. Comportement « acteur non inscrit sur Trackdéchets »

Si l'émetteur, le transporteur ou le destinataire possède un SIRET valide (format 14 chiffres) mais n'est pas inscrit sur la plateforme Trackdéchets :

- La validation Zod locale passe (SIRET syntaxiquement correct)
- L'appel à l'API TD (sandbox ou prod) retourne une erreur GraphQL
- Notre service lève `TdApiError` avec le message exact de TD
- La route retourne **HTTP 502** avec :
  ```json
  { "error": "Erreur Trackdéchets: <message TD>" }
  ```
  Le message TD contient le SIRET et explique l'absence d'inscription.
- La mission Pathélix n'est **pas bloquée** — le BSD reste en DRAFT/état précédent
- L'UI affiche l'erreur actionnable ; le dispatcher peut corriger le SIRET ou créer un compte TD pour l'établissement

Test prouvant ce comportement : `src/app/api/__tests__/bsds-sign.test.ts` → *"returns 502 with Trackdéchets error when recipient not registered"*

---

## 3. Sécurité du token & variables d'environnement

| Invariant | Vérifié |
|-----------|---------|
| `TRACKDECHETS_API_URL` = seule variable pour cibler sandbox/prod | ✅ |
| Default = sandbox (`https://sandbox.trackdechets.beta.gouv.fr/`) | ✅ |
| Aucune URL TD codée en dur (sauf default sandbox) | ✅ |
| Token stocké chiffré AES-256-GCM dans `TrackdechetsAccount.encryptedToken` | ✅ |
| Token déchiffré en mémoire uniquement, jamais loggué, jamais renvoyé par une route | ✅ |
| `GET /api/trackdechets/accounts` retourne uniquement `{configured, accountId}` | ✅ |
| Clé de chiffrement = `TRACKDECHETS_ENCRYPTION_KEY` (64 hex chars = 32 bytes) | ✅ |
| Signature webhook = `TRACKDECHETS_WEBHOOK_SECRET` via HMAC-SHA256 | ✅ |

---

## 4. Procédure de validation manuelle contre le sandbox réel

### Prérequis
1. Compte test sur https://sandbox.trackdechets.beta.gouv.fr (créer un compte établissement)
2. Générer un token API personnel dans le compte sandbox
3. Avoir deux établissements SIRET fictifs inscrits sur le sandbox (émetteur + destinataire)

### Variables à changer (`.env.local`)
```bash
USE_MOCK_DATA=false
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/
TRACKDECHETS_ENCRYPTION_KEY=<64 caractères hex>
TRACKDECHETS_WEBHOOK_SECRET=<secret pour les webhooks entrants>
DATABASE_URL=<postgres local avec migrations appliquées>
```

### Étapes de validation

**A — Configurer le compte TD**
```
POST /api/trackdechets/accounts
{ "token": "<token sandbox personnel>" }
→ HTTP 200, { ok: true, accountId: "..." }
```

**B — Créer un BSDD**
```
POST /api/bsds
{
  "emitter": { "company": { "siret": "<SIRET émetteur sandbox>", "name": "...", "address": "..." } },
  "recipient": { "processingOperation": "D9", "company": { "siret": "<SIRET destinataire sandbox>", "name": "...", "address": "..." } },
  "wasteDetails": { "code": "17 09 04", "name": "Gravats", "quantity": 2.5, "quantityType": "ESTIMATED" }
}
→ HTTP 201, { bsdId, tdId: "TD-xx-...", status: "DRAFT" }
```
Vérifier que le BSD apparaît dans l'UI sandbox TD avec statut BROUILLON.

**C — Pré-validation : test champ manquant**
```
POST /api/bsds/<id>/sign
{ "signatureType": "PRODUCER", "signatureAuthor": "Jean Test" }
(avec un BSD dont wasteDetails.name est absent)
→ HTTP 422, { error: "Données manquantes pour la signature", fields: ["wasteDetails.name — ..."] }
```
Vérifier : aucun appel TD, BSD toujours DRAFT dans la DB.

**D — Signer (producteur)**
Mettre à jour le payload BSD pour avoir `wasteDetails.name` + `quantity`, puis :
```
POST /api/bsds/<id>/sign
{ "signatureType": "PRODUCER", "signatureAuthor": "Jean Test" }
→ HTTP 200, { ok: true, status: "SIGNED_BY_PRODUCER" }
```
Vérifier dans l'UI sandbox TD que le statut a changé.

**E — Test acteur non inscrit**
```
POST /api/bsds
{ recipient: { company: { siret: "00000000000000", ... } }, ... }
→ HTTP 201 (création DRAFT — SIRET syntaxiquement valide)

POST /api/bsds/<id>/sign
{ signatureType: "PRODUCER", ... }
→ HTTP 502, { error: "Erreur Trackdéchets: L'établissement ... n'est pas inscrit" }
```

**F — Webhook statut**
Simuler un webhook entrant avec signature HMAC valide :
```bash
body='{"type":"BSD_STATUS_UPDATED","payload":{"id":"<tdId>","status":"RECEIVED","readableId":"TD-..."}}'
sig="sha256=$(echo -n "$body" | openssl dgst -sha256 -hmac "$TRACKDECHETS_WEBHOOK_SECRET" | cut -d' ' -f2)"
curl -X POST http://localhost:3000/api/webhooks/trackdechets \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $sig" \
  -d "$body"
→ HTTP 200, { ok: true }
```
Vérifier que `bsd.status` dans la DB a changé à `RECEIVED`.

### Critère de levée du HALT
La levée du HALT vers la prod requiert validation humaine de TOUTES les étapes A–F sur le sandbox réel, plus confirmation que :
- `TRACKDECHETS_API_URL` pointe vers `https://api.trackdechets.beta.gouv.fr/` (prod)
- Établissements inscrits sur la prod
- Log d'audit complet activé (Sentry)
