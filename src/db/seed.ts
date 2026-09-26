import bcrypt from 'bcryptjs';
import { loadConfig } from '../config/env.js';
import { createPool } from '../infra/db.js';

// Idempotent: fixed IDs + ON CONFLICT DO NOTHING, so `npm run seed` can be re-run safely.
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const CONTRIB_ID = '00000000-0000-4000-8000-000000000002';
const D = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

const pool = createPool(loadConfig().DATABASE_URL);

const users = [
  [ADMIN_ID, 'Admin User', 'admin@example.com', 'Admin1234!', 'ADMIN'],
  [CONTRIB_ID, 'Casey Contributor', 'contributor@example.com', 'Contributor1234!', 'CONTRIBUTOR'],
];
for (const [id, name, email, password, role] of users) {
  await pool.query(
    'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [id, name, email, await bcrypt.hash(password, 10), role],
  );
}

// [id, title, description, tags, status, owner, location_text, lng, lat]  (lng/lat null => PENDING)
type Row = [string, string, string, string[], string, string, string | null, number | null, number | null];
const disasters: Row[] = [
  [D(1), 'Flooding in Manhattan', 'Heavy flooding has affected Manhattan, NYC and nearby areas.', ['flood', 'urban'], 'ACTIVE', CONTRIB_ID, 'Manhattan, NYC', -73.9712, 40.7831],
  [D(2), 'Wildfire near Sacramento', 'A fast-moving wildfire is threatening neighbourhoods east of Sacramento, California.', ['wildfire'], 'ACTIVE', ADMIN_ID, 'Sacramento, California', -121.4944, 38.5816],
  [D(3), 'Earthquake in San Francisco', 'A magnitude 5.8 earthquake shook San Francisco; several buildings damaged.', ['earthquake', 'urban'], 'RESOLVED', CONTRIB_ID, 'San Francisco, California', -122.4194, 37.7749],
  [D(4), 'Storm damage (location pending)', 'Severe storm knocked out power across Brooklyn overnight.', ['storm'], 'ACTIVE', CONTRIB_ID, null, null, null],
  [D(5), 'Drought advisory', 'Extended drought conditions with no specific place mentioned.', ['drought'], 'CLOSED', ADMIN_ID, null, null, null],
];
for (const [id, title, description, tags, status, owner, text, lng, lat] of disasters) {
  const resolved = lng !== null && lat !== null;
  await pool.query(
    `INSERT INTO disasters (id, title, description, tags, status, created_by, location_text, location, location_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8::float8,$9::float8),4326)::geography END, $10::location_status)
     ON CONFLICT DO NOTHING`,
    [id, title, description, tags, status, owner, text, lng, lat, resolved ? 'RESOLVED' : 'PENDING'],
  );
}

// [id, name, type, lng, lat]
const resources: [string, string, string, number, number][] = [
  ['20000000-0000-4000-8000-000000000001', 'Javits Center Shelter', 'SHELTER', -74.0021, 40.7577],
  ['20000000-0000-4000-8000-000000000002', 'NYU Langone Hospital', 'HOSPITAL', -73.9739, 40.7423],
  ['20000000-0000-4000-8000-000000000003', 'Midtown Food Bank', 'FOOD', -73.9857, 40.7484],
  ['20000000-0000-4000-8000-000000000004', 'Central Park Water Station', 'WATER', -73.9654, 40.7829],
  ['20000000-0000-4000-8000-000000000005', 'FDNY Rescue 1', 'RESCUE', -73.9903, 40.7614],
  ['20000000-0000-4000-8000-000000000006', 'Brooklyn Community Shelter', 'SHELTER', -73.9442, 40.6782],
  ['20000000-0000-4000-8000-000000000007', 'SF General Hospital', 'HOSPITAL', -122.4058, 37.7559],
  ['20000000-0000-4000-8000-000000000008', 'Sacramento Relief Shelter', 'SHELTER', -121.4687, 38.5765],
];
for (const [id, name, type, lng, lat] of resources) {
  await pool.query(
    `INSERT INTO resources (id, name, type, location)
     VALUES ($1,$2,$3::resource_type, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography) ON CONFLICT DO NOTHING`,
    [id, name, type, lng, lat],
  );
}

const reports = [
  [D(1), 'seed-1', 'Streets around Midtown are under 30cm of water.', 'user201'],
  [D(1), 'seed-2', 'Subway service suspended on several lines.', 'user202'],
  [D(2), 'seed-3', 'Smoke visible from the highway, evacuation orders issued.', 'user203'],
];
for (const [disasterId, externalId, content, author] of reports) {
  await pool.query(
    `INSERT INTO community_reports (disaster_id, external_id, source, author, content, reported_at)
     VALUES ($1,$2,'mock-social',$3,$4, now() - interval '30 minutes') ON CONFLICT DO NOTHING`,
    [disasterId, externalId, author, content],
  );
}

console.log('seeded. admin@example.com / Admin1234!  contributor@example.com / Contributor1234!');
await pool.end();
