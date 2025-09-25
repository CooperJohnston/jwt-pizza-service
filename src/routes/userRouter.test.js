const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

let userAuthToken;
let user;

beforeAll(async () => {
  user = await createUser(); // regular user for /me test
});

beforeEach(async () => {
  const res = await request(app)
    .put('/api/auth')
    .send({ email: user.email, password: 'password' });
  userAuthToken = res.body.token;
});

async function createUser() {
  const name = 'Test User ' + Math.random().toString(36).substring(7);
  const email = name.replace(/ /g, '_').toLowerCase() + '@example.com';
  const password = 'password';

  // Use enum constant to match isRole(Role.Diner)
  const created = await DB.addUser({
    name,
    email,
    password,
    roles: [{ role: Role.Diner }],
  });

  // Ensure we have the full row (with id)
  const full =
    created?.id
      ? await DB.getUser({ id: created.id })
      : await DB.getUser({ email });

  return { ...full, password }; // keep plaintext only for test logins
}

// --- Admin helpers ---
function randomName() {
  return Math.random().toString(36).substring(2, 15);
}

async function createAdminUser() {
  const name = `admin-${randomName()}`;
  const email = `${name}@admin.com`;
  const password = 'toomanysecrets';

  const created = await DB.addUser({
    name,
    email,
    password,
    roles: [{ role: Role.Admin }], // enum constant
  });

  const full =
    created?.id
      ? await DB.getUser({ id: created.id })
      : await DB.getUser({ email });

  return { ...full, password };
}

test('get authenticated user', async () => {
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${userAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', user.id);
  expect(res.body).toHaveProperty('email', user.email);
});

test('admin can update another user', async () => {
  // 1) Create admin and login
  const admin = await createAdminUser();
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ email: admin.email, password: admin.password });
  expect(loginRes.status).toBe(200);
  const adminAuthToken = loginRes.body.token;

  // 2) Update target user (must have a valid id)
  expect(user.id).toBeDefined(); // guard against undefined id

  const newName = 'Updated Name ' + Math.random().toString(36).substring(7);
  const updateRes = await request(app)
    .put(`/api/user/${user.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: newName }); // only name; email/password omitted

  if (updateRes.status !== 200) {
    console.error('Update failed:', updateRes.status, updateRes.body);
  }

  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({
    id: user.id,
    name: newName,
    email: user.email,
  });
  expect(typeof updateRes.body.token).toBe('string');
});
