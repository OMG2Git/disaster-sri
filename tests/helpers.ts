import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildDeps } from './fakes.js';

export function setup(overrides = {}) {
  const { deps, fakes } = buildDeps(overrides);
  const app = createApp(deps);
  return { app, fakes, deps };
}

/** Registers (as CONTRIBUTOR) and logs in. Pass promoteToAdmin to flip the role directly in the fake store. */
export async function login(
  app: ReturnType<typeof createApp>,
  fakes: ReturnType<typeof buildDeps>['fakes'],
  email: string,
  opts: { promoteToAdmin?: boolean } = {},
) {
  await request(app).post('/auth/register').send({ name: email, email, password: 'password123' }).expect(201);
  if (opts.promoteToAdmin) fakes.users.users.find((u) => u.email === email)!.role = 'ADMIN';
  const res = await request(app).post('/auth/login').send({ email, password: 'password123' }).expect(200);
  return { Authorization: `Bearer ${res.body.access_token}` };
}
