import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';
import { testConfig } from './fakes.js';

describe('auth', () => {
  it('registers as CONTRIBUTOR and never returns the password hash', async () => {
    const { app, fakes } = setup();
    const res = await request(app).post('/auth/register').send({ name: 'A', email: 'A@Example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('CONTRIBUTOR');
    expect(res.body.email).toBe('a@example.com');
    expect(res.body.password_hash).toBeUndefined();
    expect(fakes.users.users[0].password_hash).not.toBe('password123'); // stored hashed
  });

  it('ignores a client-supplied role (no self-registration as ADMIN)', async () => {
    const { app } = setup();
    const res = await request(app).post('/auth/register').send({ name: 'Eve', email: 'eve@x.com', password: 'password123', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('CONTRIBUTOR');
  });

  it('rejects duplicate emails with 409 and weak passwords with 400', async () => {
    const { app } = setup();
    const body = { name: 'A', email: 'a@x.com', password: 'password123' };
    await request(app).post('/auth/register').send(body).expect(201);
    await request(app).post('/auth/register').send(body).expect(409);
    const weak = await request(app).post('/auth/register').send({ ...body, email: 'b@x.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('login returns a Bearer JWT with only sub + role; wrong password is 401', async () => {
    const { app } = setup();
    await request(app).post('/auth/register').send({ name: 'A', email: 'a@x.com', password: 'password123' });
    const ok = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'password123' });
    expect(ok.body.token_type).toBe('Bearer');
    const claims = jwt.verify(ok.body.access_token, testConfig.JWT_SECRET) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'role', 'sub']);

    const bad = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });
});
