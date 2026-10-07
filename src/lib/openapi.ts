import { z, type ZodType } from 'zod'
import { API_SCOPES, type ApiScope } from '@/lib/apiScopes'
import { scopeAllows } from '@/lib/apiKeyAuth'
import { BUSINESS_EVENTS } from '@/lib/events/outbound'
import {
  MissionSchema,
  MissionUpdateSchema,
  DriverSchema,
  VehicleSchema,
  OptimizeRequestSchema,
  PlanSchema,
} from '@/lib/schemas'
import {
  ClientCreateSchema,
  ClientUpdateSchema,
  SiteCreateSchema,
  SiteUpdateSchema,
  ContactSchema,
  CustomerNoteSchema,
} from '@/lib/crm/schemas'
import {
  ContainerCreateSchema,
  ContainerUpdateSchema,
  ContainerStatusSchema,
  ContainerRelocateSchema,
  ContainerTypeSchema,
  MissionContainerSchema,
} from '@/lib/containers/schemas'
import {
  QuoteSchema,
  QuoteDecisionSchema,
  ConvertQuoteSchema,
  OrderSchema,
  OrderUpdateSchema,
  ContractSchema,
  InvoiceDraftSchema,
  InvoiceUpdateSchema,
  PaymentSchema,
  PaymentAllocateSchema,
  WeighingSchema,
  WeighingReviewSchema,
  SendDocumentSchema,
  CreditNoteSchema,
  InvoicePreviewSchema,
} from '@/lib/sales/schemas'

/**
 * The public API reference (`GET /api/docs`, rendered at `/api-docs`), generated rather than
 * written: the operations listed here are exactly what an API key can reach, each with the scope
 * that opens it, and request bodies come from the Zod schemas the routes validate with. The spec
 * used to be a hand-written object describing 7 paths with their own copy of the fields.
 * `openapi.test.ts` fails when a key-reachable route is missing here or a listed one is gone.
 */

type Method = 'get' | 'post' | 'put' | 'delete'

export interface ApiOperation {
  method: Method
  /** Path under `/api`, OpenAPI style: `/missions/{id}`. */
  path: string
  summary: string
  tag: string
  body?: ZodType
  /** The body is an array of `body`. */
  bodyArray?: boolean
  query?: string[]
  /** Answers `{ data, pagination }`. */
  paged?: boolean
  /** Answers a file of this media type, not JSON. */
  binary?: string
}

const op = (
  method: Method,
  path: string,
  summary: string,
  extra: Partial<ApiOperation> = {},
): Omit<ApiOperation, 'tag'> => ({ method, path, summary, ...extra })

const GROUPS: Array<{
  tag: string
  description: string
  operations: Array<Omit<ApiOperation, 'tag'>>
}> = [
  {
    tag: 'Missions',
    description: 'Interventions à planifier : pose, retrait, échange de benne, etc.',
    operations: [
      op('get', '/missions', 'Lister les missions', { query: ['date', 'page', 'limit'] }),
      op('post', '/missions', 'Créer une mission', { body: MissionSchema }),
      op('get', '/missions/{id}', 'Lire une mission'),
      op('put', '/missions/{id}', 'Modifier une mission', { body: MissionUpdateSchema }),
      op('delete', '/missions/{id}', 'Supprimer une mission'),
      op(
        'post',
        '/missions/{id}/container',
        'Réserver (ou libérer) la benne posée par la mission',
        { body: MissionContainerSchema },
      ),
      op('get', '/missions/{id}/proof', 'Lire la preuve de passage (signature, photos)'),
      op('post', '/missions/{id}/proof', 'Enregistrer une preuve de passage'),
      op('post', '/missions/parse-natural', 'Transformer un texte libre en missions à valider'),
    ],
  },
  {
    tag: 'Chauffeurs',
    description: 'Chauffeurs, leur dépôt, leurs horaires et habilitations.',
    operations: [
      op('get', '/drivers', 'Lister les chauffeurs', { query: ['page', 'limit'] }),
      op('post', '/drivers', 'Créer un chauffeur', { body: DriverSchema }),
      op('get', '/drivers/{id}', 'Lire un chauffeur'),
      op('put', '/drivers/{id}', 'Modifier un chauffeur', { body: DriverSchema.partial() }),
      op('delete', '/drivers/{id}', 'Retirer un chauffeur'),
      op('get', '/drivers/compliance', 'Échéances réglementaires des chauffeurs'),
    ],
  },
  {
    tag: 'Véhicules',
    description: 'Camions : capacité, charge utile, types de bennes transportables.',
    operations: [
      op('get', '/vehicles', 'Lister les véhicules', { query: ['page', 'limit'] }),
      op('post', '/vehicles', 'Créer un véhicule', { body: VehicleSchema }),
      op('get', '/vehicles/{id}', 'Lire un véhicule'),
      op('put', '/vehicles/{id}', 'Modifier un véhicule', { body: VehicleSchema.partial() }),
      op('delete', '/vehicles/{id}', 'Retirer un véhicule'),
    ],
  },
  {
    tag: 'Clients',
    description:
      "Clients, contacts et suivi commercial. `externalRef` porte l'identifiant de votre ERP.",
    operations: [
      op('get', '/clients', 'Lister les clients', { query: ['page', 'limit'] }),
      op('post', '/clients', 'Créer un client', { body: ClientCreateSchema }),
      op('get', '/clients/{id}', 'Lire un client'),
      op('put', '/clients/{id}', 'Modifier un client', { body: ClientUpdateSchema }),
      op('delete', '/clients/{id}', 'Retirer un client'),
      op('get', '/clients/{id}/contacts', "Lister les contacts d'un client"),
      op('post', '/clients/{id}/contacts', 'Ajouter un contact', { body: ContactSchema }),
      op('post', '/clients/{id}/notes', 'Ajouter une note de suivi', { body: CustomerNoteSchema }),
      op('get', '/clients/{id}/overview', "Vue d'ensemble d'un client (activité, encours)"),
    ],
  },
  {
    tag: 'Sites',
    description: "Adresses d'intervention (chantiers, entrepôts…).",
    operations: [
      op('get', '/sites', 'Lister les sites', { query: ['clientId', 'page', 'limit'] }),
      op('post', '/sites', 'Créer un site', { body: SiteCreateSchema }),
      op('put', '/sites/{id}', 'Modifier un site', { body: SiteUpdateSchema }),
      op('delete', '/sites/{id}', 'Retirer un site'),
    ],
  },
  {
    tag: 'Tournées',
    description: 'Plans de tournée par chauffeur et par jour.',
    operations: [
      op('get', '/plans', "Lire les tournées d'une date", { query: ['date'] }),
      op('post', '/plans', 'Enregistrer des tournées', { body: PlanSchema, bodyArray: true }),
      op('delete', '/plans', "Supprimer les tournées d'une date", { query: ['date'] }),
      op('get', '/plans/explain', 'Pourquoi une mission est affectée à ce chauffeur', {
        query: ['date', 'missionId'],
      }),
      op('get', '/plans/p1-risk', 'Missions prioritaires en risque de retard', { query: ['date'] }),
    ],
  },
  {
    tag: 'Optimisation',
    description:
      'Calcul des tournées. Asynchrone quand un worker est disponible : interroger `/optimize/{jobId}`.',
    operations: [
      op('post', '/optimize', "Lancer l'optimisation d'une journée", {
        body: OptimizeRequestSchema,
      }),
      op('get', '/optimize/{jobId}', "État ou résultat d'une optimisation"),
      op('post', '/optimize/live', 'Ré-optimiser en cours de journée depuis les positions réelles'),
      op('post', '/optimize/resequence', "Réordonner la tournée d'un chauffeur"),
      op('post', '/optimize/simulate', 'Simuler une journée sans rien enregistrer'),
    ],
  },
  {
    tag: 'Rapports',
    description: "Indicateurs d'activité.",
    operations: [
      op('get', '/reports', "Indicateurs d'une période", { query: ['date', 'period'] }),
      op('get', '/reports/co2', 'Bilan CO₂', { query: ['from', 'to'] }),
      op('get', '/reports/pdf', 'Rapport mensuel en PDF', {
        query: ['month'],
        binary: 'application/pdf',
      }),
    ],
  },
  {
    tag: 'Parc de bennes',
    description: 'Bennes identifiées, leur type, leur emplacement et leur état.',
    operations: [
      op('get', '/containers', 'Lister les bennes', {
        query: [
          'q',
          'status',
          'typeId',
          'clientId',
          'siteId',
          'minDays',
          'archived',
          'sort',
          'page',
          'limit',
        ],
        paged: true,
      }),
      op('post', '/containers', 'Créer une benne', { body: ContainerCreateSchema }),
      op('get', '/containers/stats', 'Synthèse du parc', { query: ['longStay'] }),
      op('get', '/containers/{id}', 'Lire une benne et son historique'),
      op('put', '/containers/{id}', 'Modifier une benne', { body: ContainerUpdateSchema }),
      op('delete', '/containers/{id}', 'Retirer une benne'),
      op('post', '/containers/{id}/relocate', 'Déclarer un déplacement de benne', {
        body: ContainerRelocateSchema,
      }),
      op('post', '/containers/{id}/status', "Changer l'état d'une benne", {
        body: ContainerStatusSchema,
      }),
      op('get', '/container-types', 'Lister les types de bennes'),
      op('post', '/container-types', 'Créer un type de benne', { body: ContainerTypeSchema }),
      op('put', '/container-types/{id}', 'Modifier un type de benne', {
        body: ContainerTypeSchema.partial(),
      }),
      op('delete', '/container-types/{id}', 'Retirer un type de benne'),
    ],
  },
  {
    tag: 'Pesées',
    description: 'Tickets de pesée (saisis, lus par OCR ou transmis par un pont-bascule).',
    operations: [
      op('get', '/weighings', 'Lister les pesées', {
        query: ['status', 'missionId', 'clientId', 'exutoireId', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/weighings', 'Enregistrer une pesée', { body: WeighingSchema }),
      op('put', '/weighings/{id}', 'Corriger, valider ou rejeter une pesée', {
        body: WeighingReviewSchema,
      }),
    ],
  },
  {
    tag: 'Devis',
    description: 'Devis, de la rédaction à la décision du client.',
    operations: [
      op('get', '/quotes', 'Lister les devis', {
        query: ['q', 'status', 'clientId', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/quotes', 'Créer un devis', { body: QuoteSchema }),
      op('get', '/quotes/{id}', 'Lire un devis'),
      op('put', '/quotes/{id}', 'Modifier un devis', {
        body: QuoteSchema.omit({ clientId: true }).partial(),
      }),
      op('delete', '/quotes/{id}', 'Supprimer un devis'),
      op('post', '/quotes/{id}/send', 'Envoyer le devis au client, ou le marquer envoyé', {
        body: SendDocumentSchema,
      }),
      op('post', '/quotes/{id}/decision', "Enregistrer l'acceptation ou le refus", {
        body: QuoteDecisionSchema,
      }),
      op('post', '/quotes/{id}/convert', 'Transformer un devis accepté en commande', {
        body: ConvertQuoteSchema,
      }),
      op('post', '/quotes/{id}/duplicate', 'Dupliquer un devis'),
    ],
  },
  {
    tag: 'Commandes',
    description: 'Commandes clients et les missions qui les exécutent.',
    operations: [
      op('get', '/orders', 'Lister les commandes', {
        query: ['q', 'status', 'clientId', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/orders', 'Créer une commande', { body: OrderSchema }),
      op('get', '/orders/{id}', 'Lire une commande et son avancement'),
      op('put', '/orders/{id}', 'Modifier une commande', { body: OrderUpdateSchema }),
      op('post', '/orders/{id}/missions', "Créer les missions d'une commande"),
    ],
  },
  {
    tag: 'Contrats',
    description: "Contrats récurrents et conditions tarifaires d'un client.",
    operations: [
      op('get', '/contracts', 'Lister les contrats', {
        query: ['status', 'clientId', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/contracts', 'Créer un contrat', { body: ContractSchema }),
      op('get', '/contracts/{id}', 'Lire un contrat'),
      op('put', '/contracts/{id}', 'Modifier un contrat', {
        body: ContractSchema.omit({ clientId: true }).partial(),
      }),
    ],
  },
  {
    tag: 'Factures',
    description:
      'Facturation : brouillon, émission (numérotation définitive), envoi, avoir, export comptable.',
    operations: [
      op('get', '/invoices', 'Lister les factures et avoirs', {
        query: ['q', 'status', 'kind', 'clientId', 'from', 'to', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/invoices', 'Créer un brouillon de facture', { body: InvoiceDraftSchema }),
      op(
        'post',
        '/invoices/preview',
        "Calculer ce qu'un client doit sur une période, sans rien créer",
        { body: InvoicePreviewSchema },
      ),
      op('get', '/invoices/export', "Export comptable d'une période", {
        query: ['from', 'to', 'format'],
        binary: 'text/plain',
      }),
      op('get', '/invoices/{id}', 'Lire une facture'),
      op('put', '/invoices/{id}', 'Modifier un brouillon', { body: InvoiceUpdateSchema }),
      op('delete', '/invoices/{id}', 'Supprimer un brouillon'),
      op('post', '/invoices/{id}/issue', 'Émettre la facture (numéro définitif)'),
      op('post', '/invoices/{id}/send', 'Envoyer la facture au client, ou la marquer envoyée', {
        body: SendDocumentSchema,
      }),
      op('post', '/invoices/{id}/credit-note', 'Créer un avoir sur une facture émise', {
        body: CreditNoteSchema,
      }),
    ],
  },
  {
    tag: 'Paiements',
    description: 'Règlements reçus et leur rapprochement avec les factures.',
    operations: [
      op('get', '/payments', 'Lister les paiements', {
        query: ['clientId', 'invoiceId', 'unallocated', 'page', 'limit'],
        paged: true,
      }),
      op('post', '/payments', 'Enregistrer un paiement', { body: PaymentSchema }),
      op('put', '/payments/{id}', "Rapprocher (ou détacher) un paiement d'une facture", {
        body: PaymentAllocateSchema,
      }),
      op('delete', '/payments/{id}', 'Supprimer un paiement'),
    ],
  },
]

/** Every operation an API key can perform, in reference order. */
export const API_OPERATIONS: ApiOperation[] = GROUPS.flatMap(g =>
  g.operations.map(o => ({ ...o, tag: g.tag })),
)

/** The scope that opens `method path` — the one to tick when creating the key. */
export function requiredScope(method: string, path: string): ApiScope | null {
  return (
    API_SCOPES.find(scope =>
      scopeAllows([scope], method.toUpperCase(), `/api${path.replace(/\{[^}]+\}/g, 'x')}`),
    ) ?? null
  )
}

const QUERY_DOC: Record<string, { description: string; schema: Record<string, unknown> }> = {
  page: {
    description: 'Page (à partir de 1)',
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  limit: { description: 'Éléments par page', schema: { type: 'integer', minimum: 1 } },
  date: { description: 'Jour concerné', schema: { type: 'string', format: 'date' } },
  from: { description: 'Début de période (inclus)', schema: { type: 'string', format: 'date' } },
  to: { description: 'Fin de période (incluse)', schema: { type: 'string', format: 'date' } },
  month: { description: 'Mois (AAAA-MM)', schema: { type: 'string' } },
  q: { description: 'Recherche plein texte', schema: { type: 'string' } },
  sort: { description: 'Champ de tri ; préfixe `-` pour décroissant', schema: { type: 'string' } },
  format: {
    description: '`fec` (fichier des écritures comptables) ou `csv` (par défaut)',
    schema: { type: 'string', enum: ['fec', 'csv'] },
  },
  unallocated: {
    description: '`1` : seulement les paiements non rapprochés',
    schema: { type: 'string', enum: ['1'] },
  },
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      target: 'draft-2020-12',
    }) as Record<string, unknown>
    return rest
  } catch {
    return { type: 'object' }
  }
}

const ERROR_REF = {
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
}

function operationObject(o: ApiOperation): Record<string, unknown> {
  const scope = requiredScope(o.method, o.path)
  const pathParams = [...o.path.matchAll(/\{([^}]+)\}/g)].map(m => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
  const queryParams = (o.query ?? []).map(name => ({
    name,
    in: 'query',
    required: false,
    description: QUERY_DOC[name]?.description ?? 'Filtre',
    schema: QUERY_DOC[name]?.schema ?? { type: 'string' },
  }))
  const body = o.body ? jsonSchema(o.body) : null
  const ok = o.binary
    ? {
        description: 'Fichier',
        content: { [o.binary]: { schema: { type: 'string', format: 'binary' } } },
      }
    : o.paged
      ? {
          description: 'Page de résultats',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Page' } } },
        }
      : { description: 'Succès' }
  return {
    summary: o.summary,
    operationId: `${o.method}${o.path.replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
    tags: [o.tag],
    description: `Scope requis : \`${scope}\`.`,
    'x-required-scope': scope,
    ...(pathParams.length + queryParams.length > 0
      ? { parameters: [...pathParams, ...queryParams] }
      : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: o.bodyArray ? { type: 'array', items: body } : body },
            },
          },
        }
      : {}),
    responses: {
      200: ok,
      ...(o.method === 'get'
        ? {}
        : {
            422: {
              description: 'Corps refusé par la validation — `error` détaille les champs',
              ...ERROR_REF,
            },
          }),
      401: { description: 'Clé absente, invalide, expirée ou révoquée', ...ERROR_REF },
      403: { description: "La clé n'a pas le scope requis", ...ERROR_REF },
      ...(pathParams.length > 0
        ? { 404: { description: 'Introuvable dans votre organisation', ...ERROR_REF } }
        : {}),
      429: { description: 'Trop de requêtes' },
    },
  }
}

const EVENT_SUMMARY: Record<(typeof BUSINESS_EVENTS)[number], string> = {
  'mission.created': 'Une mission a été créée',
  'mission.completed': 'Une mission a été réalisée sur le terrain',
  'mission.failed': "Une mission n'a pas pu être réalisée",
  'container.placed': 'Une benne a été posée chez un client',
  'container.removed': 'Une benne a été retirée',
  'weighing.created': 'Une pesée a été enregistrée',
  'quote.sent': 'Un devis a été envoyé',
  'quote.accepted': 'Un devis a été accepté',
  'quote.refused': 'Un devis a été refusé',
  'order.created': 'Une commande a été créée',
  'invoice.issued': 'Une facture a été émise',
  'invoice.sent': 'Une facture a été envoyée',
  'payment.received': 'Un paiement a été enregistré',
  'route.optimized': "Les tournées d'une journée ont été calculées",
  'portal.request': 'Un client a fait une demande depuis son portail',
  'vehicle.immobilized': 'Un véhicule a été immobilisé',
}

/** The OpenAPI 3.1 document served by `GET /api/docs`. */
export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const o of API_OPERATIONS) (paths[o.path] ??= {})[o.method] = operationObject(o)

  const webhooks: Record<string, unknown> = {}
  for (const event of BUSINESS_EVENTS) {
    webhooks[event] = {
      post: {
        summary: EVENT_SUMMARY[event],
        tags: ['Webhooks sortants'],
        security: [],
        parameters: [
          {
            name: 'Pathelix-Signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description:
              '`t=<secondes Unix>,v1=<hex>` où `hex = HMAC-SHA256(secret du point de livraison, "<t>.<corps brut>")` — à vérifier avant tout traitement, en refusant un `t` vieux de plus de 5 minutes. `Pathelix-Event-Id` (stable d\'une tentative à l\'autre) et `Pathelix-Event-Type` accompagnent chaque envoi.',
          },
        ],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } },
          },
        },
        responses: {
          200: {
            description:
              'Une réponse 2xx vaut accusé de réception ; sinon la livraison est retentée.',
          },
        },
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Pathélix API',
      version: '2.0.0',
      description: [
        'API de la plateforme Pathélix : exploitation (missions, tournées, bennes, pesées) et gestion commerciale (devis, commandes, contrats, factures, paiements).',
        '',
        "**Authentification** — en-tête `X-API-Key`. Les clés se créent dans Admin → Paramètres → Accès API ; chaque clé n'ouvre que les opérations cochées (`ressource:read` pour lire, `ressource:write` pour modifier). Chaque opération ci-dessous indique son scope.",
        '',
        '**Organisation** — une clé appartient à une organisation et ne voit que ses données.',
        '',
        '**Erreurs** — `{ "error": …, "code": … }` ; `422` détaille les champs refusés.',
        '',
        '**Webhooks sortants** — Admin → Paramètres → Webhooks : les évènements listés en fin de document sont envoyés signés à vos points de livraison.',
      ].join('\n'),
      contact: { name: 'Support Pathélix', email: 'support@pathelix.com' },
    },
    servers: [{ url: '/api', description: 'Cette instance' }],
    tags: [
      ...GROUPS.map(g => ({ name: g.tag, description: g.description })),
      { name: 'Webhooks sortants', description: 'Évènements envoyés à vos systèmes.' },
    ],
    security: [{ ApiKey: [] }],
    paths,
    webhooks,
    components: {
      securitySchemes: {
        ApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: `Clé au format \`ef_live_…\`. Scopes existants : ${API_SCOPES.map(s => `\`${s}\``).join(', ')}.`,
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { description: 'Message, ou détail par champ pour une erreur de validation' },
            code: {
              type: 'string',
              description:
                'Code stable, exploitable par programme (ex. NOT_FOUND, VALIDATION, FORBIDDEN)',
            },
          },
        },
        Page: {
          type: 'object',
          required: ['data', 'pagination'],
          properties: {
            data: { type: 'array', items: { type: 'object' } },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                pages: { type: 'integer' },
              },
            },
          },
        },
        WebhookEvent: {
          type: 'object',
          required: ['id', 'type', 'createdAt', 'data'],
          properties: {
            id: {
              type: 'string',
              description:
                "Identifiant de l'évènement (`evt_…`), identique à chaque nouvelle tentative — à utiliser pour dédoublonner",
            },
            type: { type: 'string', enum: [...BUSINESS_EVENTS] },
            createdAt: { type: 'string', format: 'date-time' },
            data: { type: 'object', description: "Identifiants et montants de l'objet concerné" },
          },
        },
      },
    },
  }
}
