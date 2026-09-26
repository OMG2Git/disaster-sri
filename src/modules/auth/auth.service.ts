import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Config } from '../../config/env.js';
import { conflict, unauthorized } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { UserRepository } from './auth.repository.js';

export class AuthService {
  constructor(
    private users: UserRepository,
    private config: Pick<Config, 'JWT_SECRET' | 'JWT_EXPIRES_IN'>,
  ) {}

  async register(input: { name: string; email: string; password: string }) {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.users.create({ name: input.name, email: input.email, passwordHash, role: 'CONTRIBUTOR' });
    if (!user) throw conflict('Email is already registered');
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    // Same error for "no such user" and "wrong password" - don't leak which emails exist.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      logger.warn('login failed', { email });
      throw unauthorized('Invalid email or password');
    }
    const access_token = jwt.sign({ role: user.role }, this.config.JWT_SECRET, {
      subject: user.id,
      expiresIn: this.config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
    return { access_token, token_type: 'Bearer' as const };
  }
}
