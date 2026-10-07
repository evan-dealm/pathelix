# Pathélix — Sécurité

Modèle de sécurité, contrôles en place et risques résiduels. Vérifié contre le code (octobre
2026). Signaler une vulnérabilité : support@pathelix.com — ne pas ouvrir de ticket public.

## 1. Invariants — à ne jamais casser

1. **Isolation entre organisations.** Toute donnée d'une organisation passe par
   `getTenantDb(tenantId)` (`src/lib/tenantDb.ts`), extension Prisma qui injecte `tenantId`
   dans chaque `where` et chaque création, et lève une erreur si un appelant fournit un autre
   `tenantId`. Un modèle tenant-scoped non couvert fait échouer l'appel (fail-closed). L'accès
   brut (`@/lib/db`, `unscopedPrisma`) est interdit par ESLint hors d'une liste blanche relue :
   webhooks (organisation résolue par son secret), superadmin, workers, sondes, agrégats
   volontairement transverses (dont les vitesses de trafic : coordonnées et vitesse seules,
   sans chauffeur ni organisation).
2. **Identité dérivée du jeton uniquement.** Le middleware supprime `x-user-id`, `x-user-role`,
   `x-tenant-id` (et `x-tenant-trade`, `x-driver-ref`) entrants, vérifie le jeton, puis les
   ré-injecte. Les routes lisent l'identité via `getRequestContext(req)` — jamais un en-tête.
3. **Références vérifiées.** Un identifiant fourni par le client et pointant une autre table
   (chauffeur d'un véhicule, client/site/exutoire/dépendance d'une mission, chauffeur d'un plan…)
   est vérifié dans l'organisation avant écriture (`src/lib/tenantRefs.ts`).
4. **Validation Zod** de tout corps POST/PUT avant écriture.
5. **En-têtes de sécurité** uniquement dans `next.config.mjs` (CSP, HSTS, `X-Frame-Options: DENY`,
   `nosniff`, `Referrer-Policy`).
6. **Mode mock** : `USE_MOCK_DATA !== 'false'`. La production refuse de démarrer en mock.

## 2. Authentification

- Session : JWT HMAC-SHA256 (Web Crypto) en cookie `HttpOnly`, `SameSite=Strict`, `Secure`,
  24 h. Charge : `sub`, `role`, `tenantId`, `driverRef`, `trade`, `sv`.
- **Révocation** : chaque jeton porte la `sessionVersion` de l'utilisateur ; changement de mot de
  passe, de rôle ou suppression l'incrémente. Le middleware vérifie la version (cache 30 s,
  invalidé immédiatement sur l'instance qui révoque — cache partagé entre middleware et routes).
- **Connexion** : bcrypt ; seuls les **échecs** sont comptés — 20/min par IP, 10/15 min par compte
  (tentative réservée avant la vérification, rendue en cas de succès : une agence derrière une même
  IP ou une tablette partagée ne se bloque jamais) ; temps de réponse
  constant que le compte existe ou non (comparaison bcrypt toujours effectuée) ; l'e-mail est
  unique sur toute la plateforme.
- **IP client** : lue depuis `X-Forwarded-For` en comptant `TRUSTED_PROXY_COUNT` proxies depuis
  la droite — un client ne peut pas usurper son IP pour contourner les limites.
- **Impersonation** : un superadmin peut agir comme admin d'une organisation (`sub=sa:<id>`),
  durée limitée, journalisée.
- **Clés API** (`X-API-Key: ef_live_…`) : stockées hachées (SHA-256), expirables, révocables.
  Une clé agit comme un exploitant de son organisation, limitée à ses scopes ; toute route non
  couverte par un scope répond 403 (refus par défaut : utilisateurs, paramètres, clés, audit ne
  sont jamais accessibles). Suspension d'organisation appliquée.

## 3. Autorisations

Rôles : `superadmin` > `admin` > `dispatcher` > `driver`. Permissions fines par utilisateur
(`src/lib/permissions.ts`) : `optimize`, `manage_missions`, `manage_drivers`, `manage_vehicles`,
`manage_exutoires`, `manage_users`, `manage_settings`, `manage_integrations`, `view_reports`,
`view_costs`, `api_access`. Défaut exploitant : `optimize`, `manage_missions`, `manage_drivers`,
`manage_vehicles`, `view_reports`, `view_costs`. Vérifiées côté serveur ; l'interface masque ou
désactive les actions correspondantes.

- `manage_users` ne permet ni de créer un admin ni de modifier un admin ou son mot de passe ; le
  dernier admin d'une organisation ne peut pas être rétrogradé ou supprimé.
- **Chauffeur — refus par défaut** : une session chauffeur n'atteint que la liste explicite
  d'API de l'application chauffeur (`DRIVER_API_ALLOWLIST` du middleware) et ne voit que sa propre
  tournée ; chaque route vérifie en plus que la mission, la photo, la preuve ou l'incident lui
  appartient.
- Organisations suspendues : toutes les sessions et clés sont bloquées (y compris chemins chauffeur).

## 4. Données et fichiers

- Secrets d'intégration et jeton Trackdéchets chiffrés AES-256-GCM (`src/lib/configCrypto.ts`),
  jamais renvoyés par l'API ni journalisés.
- Fichiers déposés (photos, signatures) **hors de `public/`**, servis par `/api/files/…` après
  contrôle d'accès ; type réel vérifié par signature binaire, 5 Mo max, noms aléatoires.
- **Suivi client** (`/track/<jeton>`) : jeton opaque aléatoire, à durée limitée, qui ne donne
  accès qu'au suivi de sa mission (pas une session).
- Impressions (feuilles de route) : contenu échappé — pas d'injection HTML via un nom de client.
- Journal d'audit des mutations sensibles, conservé `AUDIT_RETENTION_DAYS` (365 j) ; positions
  GPS purgées après `POSITION_RETENTION_DAYS` (30 j).

## 5. Entrées externes

- **Webhooks** (Nessy HMAC-SHA256, OBD bearer, Geotab/Samsara clé) : secret **par organisation** ;
  l'organisation est trouvée par le secret qui valide, jamais par un en-tête client. Comparaisons
  à temps constant.
- **Appels sortants configurés par un admin** (webhooks, ERP, test d'intégration) : protection
  SSRF (`src/lib/outboundUrl.ts`) — adresses privées, de bouclage et de métadonnées cloud
  refusées après résolution DNS, redirections non suivies ; `OUTBOUND_ALLOWED_HOSTS` pour des
  exceptions explicites. Endpoints de notification push limités aux services push connus.
- **Actions chauffeur hors ligne** : rejouables sans doublon (`Idempotency-Key`, réservation
  atomique en base) ; mises à jour de statut sérialisées par verrou de ligne.
- Limitation globale dans le middleware : 600 req/min par utilisateur connecté, 300 par IP pour le
  trafic anonyme (signature du jeton vérifiée avant de choisir la clé) ; corps limités à 5 Mo.

## 6. Risques résiduels acceptés

| Risque | Pourquoi accepté / suite |
|---|---|
| CSP avec `'unsafe-inline'` (scripts, styles) | Requis par Next.js sans nonces ; les contenus utilisateur sont échappés. Passage aux nonces possible |
| DNS rebinding entre contrôle SSRF et connexion | Endpoints configurés par un admin ; une résolution épinglée fermerait le risque |
| Caches de révocation/suspension par process (30 s) | Serveur unique ; un déploiement multi-instance demanderait une invalidation partagée |
| Pas de Row-Level Security PostgreSQL | L'extension `getTenantDb` est la barrière ; RLS (politiques par modèle + transaction posant `app.tenant_id`) est conçue mais coûterait une transaction par requête — à mesurer en charge avant décision |
| Dépendance `swagger-ui-react` (chaîne modérée) | N'interprète que notre propre spécification |
| Trackdéchets | HALT appliqué dans le code — voir OPERATIONS.md §8 |

## 7. Tests de non-régression

Chaque correctif de sécurité a son test : middleware (en-têtes usurpés, chauffeur, clés API,
suspension), `tenantDb` (injection et refus), références inter-organisations, SSRF, révocation,
uploads, idempotence, webhooks. Ils font partie de `npm test`.
