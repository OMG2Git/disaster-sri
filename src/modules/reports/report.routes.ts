import { Router } from 'express';
import { idParamSchema } from '../disasters/disaster.schema.js';
import type { ReportsService } from './report.service.js';

export function reportRoutes(service: ReportsService) {
  const router = Router();
  router.get('/:id/reports', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await service.getReports(id));
  });
  return router;
}
