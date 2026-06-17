import { NextResponse } from 'next/server'

const spec = {
  openapi: '3.1.0',
  info: {
    title:       'Pathélix API',
    version:     '1.0.0',
    description: 'API publique pour la gestion de flottes et l\'optimisation des tournées.',
    contact:     { name: 'Support Pathélix', email: 'support@pathelix.com' },
  },
  servers: [{ url: '/api', description: 'Serveur de production' }],
  components: {
    securitySchemes: {
      ApiKey: {
        type: 'apiKey',
        in:   'header',
        name: 'X-API-Key',
      },
      BearerAuth: {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Mission: {
        type: 'object',
        required: ['id', 'type', 'date', 'address', 'latitude', 'longitude', 'estimatedDurationMin'],
        properties: {
          id:                   { type: 'string' },
          type:                 { type: 'string', enum: ['POSER','RETIRER','ECHANGER','VIDER','PAUSE','CHARGER_IMMEDIAT','DEPLACER','TASSER','EXPEDIER','ALLER_RETOUR'] },
          date:                 { type: 'string', format: 'date' },
          address:              { type: 'string' },
          latitude:             { type: 'number' },
          longitude:            { type: 'number' },
          estimatedDurationMin: { type: 'integer' },
          clientName:           { type: 'string', nullable: true },
          priority:             { type: 'integer', enum: [1, 2, 3], nullable: true },
          archived:             { type: 'boolean' },
        },
      },
      Driver: {
        type: 'object',
        required: ['id', 'firstName', 'lastName', 'sector', 'depotLat', 'depotLng'],
        properties: {
          id:           { type: 'string' },
          firstName:    { type: 'string' },
          lastName:     { type: 'string' },
          sector:       { type: 'string' },
          depotLat:     { type: 'number' },
          depotLng:     { type: 'number' },
          archived:     { type: 'boolean' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      OptimizeRequest: {
        type: 'object',
        required: ['date'],
        properties: {
          date:      { type: 'string', format: 'date' },
          driverIds: { type: 'array', items: { type: 'string' }, nullable: true },
          options: {
            type: 'object',
            properties: {
              timeBudgetMs:    { type: 'integer', default: 15000 },
              seed:            { type: 'integer', default: 42 },
            },
          },
        },
      },
    },
  },
  security: [{ ApiKey: [] }],
  paths: {
    '/missions': {
      get: {
        summary:     'Lister les missions',
        operationId: 'listMissions',
        tags:        ['Missions'],
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'archived', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          200: { description: 'Liste de missions', content: { 'application/json': { schema: { type: 'object', properties: { missions: { type: 'array', items: { $ref: '#/components/schemas/Mission' } } } } } } },
          401: { description: 'Non authentifié' },
        },
      },
      post: {
        summary:     'Créer une mission',
        operationId: 'createMission',
        tags:        ['Missions'],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Mission' } } } },
        responses: {
          201: { description: 'Mission créée' },
          422: { description: 'Validation échouée' },
        },
      },
    },
    '/missions/{id}': {
      get: {
        summary:     'Récupérer une mission',
        operationId: 'getMission',
        tags:        ['Missions'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Mission', content: { 'application/json': { schema: { $ref: '#/components/schemas/Mission' } } } },
          404: { description: 'Mission introuvable' },
        },
      },
      put: {
        summary:     'Mettre à jour une mission',
        operationId: 'updateMission',
        tags:        ['Missions'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Mission' } } } },
        responses: { 200: { description: 'Mise à jour effectuée' } },
      },
    },
    '/drivers': {
      get: {
        summary:     'Lister les chauffeurs',
        operationId: 'listDrivers',
        tags:        ['Chauffeurs'],
        responses: { 200: { description: 'Liste de chauffeurs' } },
      },
    },
    '/optimize': {
      post: {
        summary:     'Lancer une optimisation de tournées',
        operationId: 'optimize',
        tags:        ['Optimisation'],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OptimizeRequest' } } } },
        responses: {
          200: { description: 'Résultat synchrone (sans worker Redis)' },
          202: { description: 'Job en file d\'attente', content: { 'application/json': { schema: { type: 'object', properties: { jobId: { type: 'string' } } } } } },
        },
      },
    },
    '/optimize/{jobId}': {
      get: {
        summary:     'Statut / résultat d\'un job d\'optimisation',
        operationId: 'getOptimizeJob',
        tags:        ['Optimisation'],
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Résultat disponible' },
          202: { description: 'Job en cours de traitement' },
          404: { description: 'Job introuvable' },
        },
      },
    },
    '/plans': {
      post: {
        summary:     'Sauvegarder les plans de tournée',
        operationId: 'savePlans',
        tags:        ['Plans'],
        responses:   { 200: { description: 'Plans sauvegardés' } },
      },
    },
  },
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(spec, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
