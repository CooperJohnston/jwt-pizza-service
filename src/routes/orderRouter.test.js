// __tests__/orderRouter.test.js
const request = require('supertest');
jest.mock('../metrics.js', () => ({
  requestTracker: () => (req, res, next) => next(),   // no-op middleware
  recordAuthAttempt: () => {},
  markUserSeen: () => {},
  recordOrderPlaced: () => {},
  recordOrderFailure: () => {},
  recordFactoryLatency: () => {},
  sendMetricsPeriodically: () => {},
}));
const app = require('../service');
const { Role, DB } = require('../database/database.js');

let admin, adminToken;
let diner, dinerToken;
let franchise, store;

function rand() {
  return Math.random().toString(36).slice(2, 10);
}

async function createUser({ role }) {
  const name = `${role}-user-${rand()}`;
  const email = `${name}@test.com`;
  const password = role === 'admin' ? 'toomanysecrets' : 'password';
  await DB.addUser({
    name,
    email,
    password,
    roles: [{ role: role === 'admin' ? Role.Admin : Role.Diner }],
  });
  // refresh to ensure we have id/roles
  const full = await DB.getUser(email);
  return { ...full, password };
}

beforeAll(async () => {
  // admin + diner
  admin = await createUser({ role: 'admin' });
  diner = await createUser({ role: 'diner' });

  // login both
  const a = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
  expect(a.status).toBe(200);
  adminToken = a.body.token;

  const d = await request(app).put('/api/auth').send({ email: diner.email, password: diner.password });
  expect(d.status).toBe(200);
  dinerToken = d.body.token;

  // franchise + store so we can place orders
  franchise = await DB.createFranchise({ name: `Fr-${rand()}`, admins: [{ email: admin.email }] });
  store = await DB.createStore(franchise.id, { name: `Store-${rand()}` });

  // seed one menu item (can also test via PUT route later)
  await DB.addMenuItem({
    title: 'Veggie',
    description: 'A garden of delight',
    image: 'pizza1.png',
    price: 0.0038,
  });
});



describe('GET /api/order/menu', () => {
  test('returns menu without auth', async () => {
    const res = await request(app).get('/api/order/menu');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('title');
  });
});

describe('PUT /api/order/menu', () => {
  test('fails for non-admin', async () => {
    const res = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send({ title: 'Student', description: 'No topping', image: 'pizza9.png', price: 0.0001 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: 'unable to add menu item' });
  });

  test('succeeds for admin and returns updated menu', async () => {
    const newItem = { title: `Student-${rand()}`, description: 'Just carbs', image: 'pizza9.png', price: 0.0001 };
    const res = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(newItem);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find(m => m.title === newItem.title);
    expect(found).toBeTruthy();
    expect(found).toMatchObject({ title: newItem.title, image: newItem.image, price: newItem.price });
  });
});

describe('GET /api/order', () => {
  test('returns orders for authenticated diner (initially empty)', async () => {
    const res = await request(app)
      .get('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dinerId', diner.id);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });
});

describe('POST /api/order', () => {
  beforeEach(() => {
    // mock external factory call
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ reportUrl: 'https://factory.example/report/123', jwt: 'factory.jwt.token' }),
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('creates a diner order and calls factory', async () => {
    // need a real menuId from DB.getMenu
    const menu = await DB.getMenu();
    expect(menu.length).toBeGreaterThan(0);
    const menuId = menu[0].id;

    const payload = {
      franchiseId: franchise.id,
      storeId: store.id,
      items: [{ menuId, description: menu[0].title, price: menu[0].price }],
    };

    const res = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send(payload);

    if (res.status !== 200) {
      console.error('POST /api/order failed:', res.status, res.body);
    }

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('order');
    expect(res.body.order).toMatchObject({
      franchiseId: payload.franchiseId,
      storeId: payload.storeId,
    });
    expect(Array.isArray(res.body.order.items)).toBe(true);
    expect(res.body).toHaveProperty('followLinkToEndChaos', 'https://factory.example/report/123');
    expect(res.body).toHaveProperty('jwt', 'factory.jwt.token');

    // validate factory call payload roughly
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(typeof url).toBe('string');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body).toHaveProperty('diner.id', diner.id);
    expect(body).toHaveProperty('order.id'); // created by DB.addDinerOrder
  });

  test('propagates factory failure as 500 with report link', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ reportUrl: 'https://factory.example/report/fail' }),
    }));

    const menu = await DB.getMenu();
    const payload = {
      franchiseId: franchise.id,
      storeId: store.id,
      items: [{ menuId: menu[0].id, description: menu[0].title, price: menu[0].price }],
    };

    const res = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send(payload);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      message: 'Failed to fulfill order at factory',
      followLinkToEndChaos: 'https://factory.example/report/fail',
    });
  });
});
