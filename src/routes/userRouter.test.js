const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

// ---------- Helpers ----------
function rand() {
  return Math.random().toString(36).slice(2, 10);
}

async function createUser(role = Role.Diner) {
  const name = `Test ${rand()}`;
  const email = `${name.replace(/\s+/g, '_').toLowerCase()}@example.com`;
  const password = 'password';

  const created = await DB.addUser({ name, email, password, roles: [{ role }] });

  // Ensure we have id (some DBs return partial row from addUser)
  let full = created;
  if (!full?.id) {
    // Prefer whichever your DB supports:
    // full = await DB.getUser({ email });
    full = await DB.getUser(email, password); // if your DB.getUser(email, password) returns the row
  }

  return { ...full, password };
}

async function login(email, password) {
  const res = await request(app).put('/api/auth').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

// ---------- Tests ----------

// No global beforeEach that logs in!
// If you want grouping, use describe blocks + local beforeEach.

test('get authenticated user (/api/user/me)', async () => {
  const me = await createUser(Role.Diner);
  const token = await login(me.email, me.password);

  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', me.id);
  expect(res.body).toHaveProperty('email', me.email);
});

test('admin can update another user (/api/user/:id PUT)', async () => {
  const admin = await createUser(Role.Admin);
  const target = await createUser(Role.Diner);

  const adminToken = await login(admin.email, admin.password);

  const newName = `Updated ${rand()}`;
  const res = await request(app)
    .put(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: newName });

  if (res.status !== 200) {
    console.error('Update failed:', res.status, res.body);
  }

  expect(res.status).toBe(200);
  // Your docs say response is { user, token }
  expect(res.body.user).toMatchObject({ id: target.id, name: newName, email: target.email });
  expect(typeof res.body.token).toBe('string');
});

test('list users unauthorized -> 401', async () => {
  const res = await request(app).get('/api/user?page=0&limit=10&name=*');
  expect(res.status).toBe(401);
});

test('list users as non-admin -> 403', async () => {
  const diner = await createUser(Role.Diner);
  const dinerToken = await login(diner.email, diner.password);

  const res = await request(app)
    .get('/api/user?page=0&limit=10&name=*')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
});

test('list users as admin -> 200', async () => {
  const admin = await createUser(Role.Admin);
  const adminToken = await login(admin.email, admin.password);

  const res = await request(app)
    .get('/api/user?page=0&limit=10&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');
});

test('200 when admin deletes an existing user', async () => {
  const target = await createUser(Role.Diner);
  const admin  = await createUser(Role.Admin);
  const adminToken = await login(admin.email, admin.password);

  const res = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  console.log(res.body);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'user deleted' });

  // Optional: deleting again should 404
  const res2 = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res2.status).toBe(404);
});

test('401 when not authenticated', async () => {
  const res = await request(app).delete('/api/user/1');
  expect(res.status).toBe(401);
});

test('403 when authenticated but not admin', async () => {
  const diner = await createUser(Role.Diner);
  const dinerToken = await login(diner.email, diner.password);

  const res = await request(app)
    .delete(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
});

test('404 when admin deletes non-existent user', async () => {
  const admin = await createUser(Role.Admin);
  const adminToken = await login(admin.email, admin.password);

  const res = await request(app)
    .delete('/api/user/99999999')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(404);
});
