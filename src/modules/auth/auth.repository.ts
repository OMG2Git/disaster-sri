import type { Pool } from '../../infra/db.js';
import type { Role, User, UserWithHash } from '../../types.js';

export interface UserRepository {
  /** Returns null if the email is already taken. */
  create(input: { name: string; email: string; passwordHash: string; role: Role }): Promise<User | null>;
  findByEmail(email: string): Promise<UserWithHash | null>;
}

const PUBLIC_COLS = 'id, name, email, role, created_at, updated_at';

export class PgUserRepository implements UserRepository {
  constructor(private pool: Pool) {}

  async create({ name, email, passwordHash, role }: { name: string; email: string; passwordHash: string; role: Role }) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING RETURNING ${PUBLIC_COLS}`,
      [name, email, passwordHash, role],
    );
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const { rows } = await this.pool.query(`SELECT ${PUBLIC_COLS}, password_hash FROM users WHERE email = $1`, [email]);
    return rows[0] ?? null;
  }
}
