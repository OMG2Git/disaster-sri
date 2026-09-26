import { Router, type RequestHandler } from 'express';
import type { DisasterService } from './disaster.service.js';
import {
  createDisasterSchema,
  idParamSchema,
  listDisastersQuerySchema,
  updateDisasterSchema,
} from './disaster.schema.js';

export function disasterRoutes(
  service: DisasterService,
  auth: { authenticate: RequestHandler; requireRole: (...r: ('ADMIN' | 'CONTRIBUTOR')[]) => RequestHandler },
) {
  const router = Router();

  router.post('/', auth.authenticate, auth.requireRole('ADMIN', 'CONTRIBUTOR'), async (req, res) => {
    const disaster = await service.create(createDisasterSchema.parse(req.body), req.user!);
    res.status(201).json(disaster);
  });

  router.get('/', async (req, res) => {
    res.json(await service.list(listDisastersQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await service.get(id));
  });

  router.patch('/:id', auth.authenticate, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await service.update(id, updateDisasterSchema.parse(req.body), req.user!));
  });

  router.delete('/:id', auth.authenticate, auth.requireRole('ADMIN'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await service.delete(id);
    res.status(204).end();
  });

  return router;
}
