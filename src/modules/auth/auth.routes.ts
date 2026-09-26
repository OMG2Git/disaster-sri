import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AuthService } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.schema.js';

export function authRoutes(service: AuthService, opts: { rateLimitMax: number }) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: opts.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
    }),
  );

  router.post('/register', async (req, res) => {
    const user = await service.register(registerSchema.parse(req.body));
    res.status(201).json(user);
  });

  router.post('/login', async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await service.login(email, password));
  });

  return router;
}
