Voici tout ce qui dépend de toi, vérifié dans .env, .env.example, le code et OPERATIONS.md. La liste est classée par priorité : l'appli tourne déjà en local, donc l'essentiel concerne les fonctions aujourd'hui inactives et la mise en production.

1. À faire tout de suite (aucun compte à créer)

1. Mettre le code à l'abri. Le dépôt n'a aucun remote git : tout le projet n'existe que sur ce PC. Crée un dépôt privé (GitHub ou GitLab) et pousse dessus. Il faut d'abord committer le travail d'aujourd'hui, qui ne l'est pas.
2. Activer ta double authentification : /superadmin → Sécurité, avec une appli d'authentification sur ton téléphone.
3. Ajouter INTEGRATION_ENCRYPTION_KEY dans .env (openssl rand -hex 32). Sans elle, les intégrations (webhooks, télématique, ERP) ne peuvent pas être enregistrées et le secret 2FA est stocké en clair.
4. Savoir quelle base tu utilises. npm start lit .env.production.local et part sur la base de test ; npm run dev lit .env et part sur pathelix_fleet. À toi de décider laquelle est ta « vraie » base ; pour que npm start utilise pathelix_fleet, il faut retirer DATABASE_URL de .env.production.local.

2. Comptes à créer et informations à fournir

┌───────────────┬──────────────────────────────────────────────────────┬─────────────────────────────────────────────────┐
│     Quoi      │                       Pourquoi                       │              Ce que tu renseignes               │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│               │ Envoi des devis, factures, invitations au portail    │                                                 │
│ Brevo (ou     │ client, relances, demandes de démo. Sans lui, rien   │ SMTP_URL=smtp://identifiant:clé@hôte:port et    │
│ autre SMTP)   │ n'est envoyé : l'appli affiche le lien ou le PDF à   │ MAIL_FROM                                       │
│               │ transmettre à la main.                               │                                                 │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Adresse de    │ Recevoir par e-mail les demandes du formulaire       │                                                 │
│ réception des │ /contact (elles restent visibles dans Superadmin de  │ DEMO_REQUEST_TO                                 │
│  démos        │ toute façon).                                        │                                                 │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Nom de        │ Site public et accès HTTPS.                          │ NEXT_PUBLIC_SITE_URL, lu au moment du build     │
│ domaine       │                                                      │                                                 │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Mentions      │ Les pages légales du site sont vides : tous les      │ Raison sociale, forme, SIREN, adresse,          │
│ légales       │ champs LEGAL de src/lib/site/config.ts sont à null.  │ directeur de publication, hébergeur             │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Clés push     │ Notifications push aux chauffeurs. Absentes de .env, │ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,            │
│ (VAPID)       │  donc inactives.                                     │ VAPID_EMAIL                                     │
├───────────────┼──────────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Sentry        │ Remontée des erreurs. Le DSN est déjà défini.        │ SENTRY_AUTH_TOKEN (vide) si tu veux des traces  │
│               │                                                      │ lisibles                                        │
└───────────────┴──────────────────────────────────────────────────────┴─────────────────────────────────────────────────┘

Pour Brevo : dans ton compte, section SMTP, tu récupères un identifiant, une clé SMTP, l'hôte et le port. Il faut aussi valider ton domaine d'envoi (enregistrements DNS SPF et DKIM), sinon les e-mails partent en spam. Aucun code spécifique à Brevo n'existe dans l'appli : n'importe quel fournisseur SMTP convient.

3. Mise en production

1. Un serveur. OPERATIONS.md indique 16 Go de RAM et 8 cœurs minimum jusqu'à 20 chauffeurs, 32 Go et 14 cœurs jusqu'à 50.
2. Un reverse proxy HTTPS (Caddy ou Nginx) devant l'appli. Aucun fichier de configuration n'est fourni dans le dépôt, il faut l'écrire.
3. Un .env de production avec des secrets neufs : DB_PASSWORD, SESSION_SECRET (openssl rand -base64 48), SUPERADMIN_PASSWORD, USE_MOCK_DATA=false. Retire FORCE_HTTPS=false pour que le cookie de session soit sécurisé.
4. Lancement : docker compose build, docker compose up -d, puis npm run db:seed-superadmin une fois. Valhalla met 15 à 30 minutes au premier démarrage.
5. Sauvegardes : mettre scripts/backup-pg.sh en cron quotidien, copier les sauvegardes hors du serveur, et sauvegarder aussi le dossier des photos et signatures. Rejoue une restauration avant la mise en service.
6. Supervision : une alerte sur /api/ready au minimum.

4. Seulement si un client en a besoin

- Trackdéchets (bordereaux de déchets) : bloqué volontairement dans le code. Il faut un compte sandbox, dérouler les 6 étapes de validation d'OPERATIONS.md §8, puis TRACKDECHETS_ENCRYPTION_KEY et la levée du blocage.
- Télématique et ERP (Geotab, Samsara, Nessy, OBD) : chaque organisation saisit ses propres identifiants dans Paramètres → Intégrations. Rien à faire côté serveur, sauf la clé du point 1.3.
- Routage externe (Trimble ou HERE) : clé payante, facultative, Valhalla suffit.
- Lecture automatique des tickets de pesée : service optionnel (docker compose --profile ocr up). Sans lui, le poids se saisit à la main.
- Stockage S3 : facultatif, les fichiers sont sur le disque par défaut.
- Fond de carte MapTiler : facultatif, un fond gratuit est utilisé sans clé.

5. Ce qui fonctionne déjà sans rien ajouter

Connexion, console superadmin, gestion des missions, chauffeurs et véhicules, optimisation des tournées, appli chauffeur, PDF (avec le worker lancé), cartes, site public.

Il n'y a pas de paiement en ligne dans l'appli (aucune intégration Stripe) : la facturation de tes clients se fait hors appli.

Je peux préparer le .env complet avec les clés générées (chiffrement, VAPID) et des emplacements vides pour ce que toi seul peux fournir ; il te resterait Brevo, le domaine et les mentions légales.