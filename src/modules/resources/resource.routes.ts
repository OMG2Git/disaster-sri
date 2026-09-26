import { Router } from 'express';
import { idParamSchema } from '../disasters/disaster.schema.js';
import { nearbyQuerySchema } from './resource.schema.js';
import type { ResourceService } from './resource.service.js';

export function resourceRoutes(service: ResourceService) {
  const router = Router();
  router.get('/:id/resources', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ resources: await service.findNearby(id, nearbyQuerySchema.parse(req.query)) });
  });
  return router;
}
