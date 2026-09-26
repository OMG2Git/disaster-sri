import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Config } from '../config/env.js';
import type { AuthUser, Role } from '../types.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createAuth(config: Pick<Config, 'JWT_SECRET'>) {
  /** Authentication: who are you? Sets req.user from the Bearer token or responds 401. */
  const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    try {
      const claims = jwt.verify(header.slice(7), config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (typeof claims.sub !== 'string' || (claims.role !== 'ADMIN' && claims.role !== 'CONTRIBUTOR')) {
        throw new Error('bad claims');
      }
      req.user = { id: claims.sub, role: claims.role };
      next();
    } catch {
      logger.warn('authentication failed', { path: req.path, ip: req.ip });
      throw unauthorized('Invalid or expired token');
    }
  };

  /** Authorization (coarse, role-level). Ownership checks live in the service layer. */
  const requireRole =
    (...roles: Role[]): RequestHandler =>
    (req, _res, next) => {
      if (!req.user || !roles.includes(req.user.role)) throw forbidden();
      next();
    };

  return { authenticate, requireRole };
}
