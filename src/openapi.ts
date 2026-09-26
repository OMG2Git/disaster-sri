// Hand-written OpenAPI 3 spec, served at /docs (Swagger UI) and /openapi.json.
const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const json = (ref: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const secured = [{ bearerAuth: [] }];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Disaster Response Coordination API',
    version: '1.0.0',
    description:
      'PostgreSQL/PostGIS is the source of truth. Location resolution (Gemini -> Nominatim) is asynchronous: ' +
      'new disasters start with `location_status: PENDING`.\n\n' +
      '**Realtime:** `GET /events/disasters` (Server-Sent Events) is served by the realtime service ' +
      '(default http://localhost:3001), not by this API process. See the SSE section at the bottom of the spec.',
  },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'Auth' }, { name: 'Disasters' }, { name: 'Resources' }, { name: 'Community reports' }, { name: 'Realtime' }, { name: 'Health' }],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register (always role CONTRIBUTOR)',
        requestBody: { required: true, content: json('RegisterRequest') },
        responses: {
          '201': { description: 'Created', content: json('User') },
          '400': err('Validation error'),
          '409': err('Email already registered'),
          '429': err('Rate limited'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login, returns a JWT (claims: sub, role)',
        requestBody: { required: true, content: json('LoginRequest') },
        responses: {
          '200': { description: 'OK', content: json('TokenResponse') },
          '400': err('Validation error'),
          '401': err('Invalid credentials'),
          '429': err('Rate limited'),
        },
      },
    },
    '/disasters': {
      post: {
        tags: ['Disasters'],
        summary: 'Create a disaster (ADMIN, CONTRIBUTOR)',
        description: 'Inserts the disaster and a `disaster.created` outbox event in one transaction. Never calls Gemini/Nominatim.',
        security: secured,
        requestBody: { required: true, content: json('CreateDisaster') },
        responses: {
          '201': { description: 'Created (location_status = PENDING)', content: json('Disaster') },
          '400': err('Validation error'),
          '401': err('Missing/invalid token'),
        },
      },
      get: {
        tags: ['Disasters'],
        summary: 'List disasters (public, cached)',
        parameters: [
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/DisasterStatus' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Disaster' } } } } },
          '400': err('Invalid query parameters'),
        },
      },
    },
    '/disasters/{id}': {
      parameters: [idParam],
      get: {
        tags: ['Disasters'],
        summary: 'Get a disaster (public, cached)',
        responses: { '200': { description: 'OK', content: json('Disaster') }, '404': err('Not found') },
      },
      patch: {
        tags: ['Disasters'],
        summary: 'Update a disaster (ADMIN any; CONTRIBUTOR only own)',
        security: secured,
        requestBody: { required: true, content: json('UpdateDisaster') },
        responses: {
          '200': { description: 'OK', content: json('Disaster') },
          '400': err('Validation error'),
          '401': err('Missing/invalid token'),
          '403': err('Contributor does not own this disaster'),
          '404': err('Not found'),
        },
      },
      delete: {
        tags: ['Disasters'],
        summary: 'Delete a disaster (ADMIN only). Its community reports are deleted with it.',
        security: secured,
        responses: { '204': { description: 'Deleted' }, '401': err('Missing/invalid token'), '403': err('Not an admin'), '404': err('Not found') },
      },
    },
    '/disasters/{id}/resources': {
      parameters: [idParam],
      get: {
        tags: ['Resources'],
        summary: 'Nearby emergency resources (PostGIS ST_DWithin), nearest first',
        description:
          'Search center: `lat`+`lng` if provided (both required together); otherwise the disaster\'s own resolved location. ' +
          'If neither is available (location still PENDING/FAILED) the API returns 422.',
        parameters: [
          { name: 'lat', in: 'query', schema: { type: 'number', minimum: -90, maximum: 90 } },
          { name: 'lng', in: 'query', schema: { type: 'number', minimum: -180, maximum: 180 } },
          { name: 'radius', in: 'query', description: 'Kilometers', schema: { type: 'number', exclusiveMinimum: 0, maximum: 500, default: 10 } },
          { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/ResourceType' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: {
          '200': { description: 'OK', content: json('ResourcesResponse') },
          '400': err('Invalid query parameters'),
          '404': err('Disaster not found'),
          '422': err('No search center available'),
        },
      },
    },
    '/disasters/{id}/reports': {
      parameters: [idParam],
      get: {
        tags: ['Community reports'],
        summary: 'Community reports from the external service (cache-aside, stale fallback)',
        description:
          '`meta.source` is `cache`, `external`, or `stale-cache` (upstream failed, served a previously cached copy). ' +
          'If the upstream fails and nothing is cached: 503.',
        responses: {
          '200': { description: 'OK', content: json('ReportsResponse') },
          '404': err('Disaster not found'),
          '503': err('External service unavailable and no cached data'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness + dependency status',
        responses: { '200': { description: 'ok or degraded (Redis down)' }, '503': { description: 'PostgreSQL down' } },
      },
    },
  },
  'x-sse': {
    'GET /events/disasters': {
      server: 'http://localhost:3001 (realtime service)',
      contentType: 'text/event-stream',
      auth: 'none',
      events: ['disaster.created', 'disaster.updated', 'disaster.deleted', 'disaster.location_resolved'],
      frame: 'id: <event_id>\\nevent: <type>\\ndata: {"event_id","event_type","aggregate_type","aggregate_id","occurred_at","payload"}\\n\\n',
      keepalive: 'a `: ping` comment line every 15s',
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: {} },
          },
        },
      },
      DisasterStatus: { type: 'string', enum: ['ACTIVE', 'RESOLVED', 'CLOSED'] },
      ResourceType: { type: 'string', enum: ['SHELTER', 'HOSPITAL', 'FOOD', 'WATER', 'RESCUE'] },
      LatLng: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      RegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
      },
      TokenResponse: {
        type: 'object',
        properties: { access_token: { type: 'string' }, token_type: { type: 'string', example: 'Bearer' } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' },
          role: { type: 'string', enum: ['ADMIN', 'CONTRIBUTOR'] },
          created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateDisaster: {
        type: 'object',
        required: ['title', 'description'],
        properties: {
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 5000 },
          tags: { type: 'array', maxItems: 20, items: { type: 'string' } },
          status: { $ref: '#/components/schemas/DisasterStatus' },
        },
      },
      UpdateDisaster: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          title: { type: 'string' }, description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }, status: { $ref: '#/components/schemas/DisasterStatus' },
        },
      },
      Disaster: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, description: { type: 'string' },
          location_text: { type: 'string', nullable: true },
          location: { allOf: [{ $ref: '#/components/schemas/LatLng' }], nullable: true },
          location_status: { type: 'string', enum: ['PENDING', 'RESOLVED', 'FAILED'] },
          location_attempts: { type: 'integer' },
          location_error: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          status: { $ref: '#/components/schemas/DisasterStatus' },
          created_by: { type: 'string', format: 'uuid' },
          created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ResourcesResponse: {
        type: 'object',
        properties: {
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
                type: { $ref: '#/components/schemas/ResourceType' }, distance_km: { type: 'number' },
                location: { $ref: '#/components/schemas/LatLng' },
              },
            },
          },
        },
      },
      ReportsResponse: {
        type: 'object',
        properties: {
          reports: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                external_id: { type: 'string' }, source: { type: 'string' }, author: { type: 'string', nullable: true },
                content: { type: 'string' }, reported_at: { type: 'string', format: 'date-time' },
              },
            },
          },
          meta: {
            type: 'object',
            properties: { source: { type: 'string', enum: ['cache', 'external', 'stale-cache'] }, stale: { type: 'boolean' } },
          },
        },
      },
    },
  },
};
