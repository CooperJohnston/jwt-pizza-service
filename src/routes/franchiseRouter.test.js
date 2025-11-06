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

let adminAuthToken;
let admin;

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  //console.log('Created admin user:', user);
  return { ...user, password: 'toomanysecrets' };
}

function randomName() {
  return Math.random().toString(36).substring(2, 15);
}

beforeAll(async () => {
  admin = await createAdminUser();
}
);

beforeEach(async () => {
    const res = await request(app).put('/api/auth').send(admin);
    adminAuthToken = res.body.token;
  });

test('create franchise', async () => {

    const newFranchise = { 
        name: 'Test Franchise ' + randomName(),
        admins: [{ email: admin.email }]  
      };
    const createRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newFranchise);
    expect(createRes.status).toBe(200);
    expect(createRes.body).toMatchObject(newFranchise)})

test('get franchises', async () => {
    const res = await request(app)
        .get('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.franchises)).toBe(true);
})

test('get user franchises', async () => {
    const res = await request(app)
        .get(`/api/franchise/${admin.id}`)
        .set('Authorization', `Bearer ${adminAuthToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Since we created a franchise with this admin in previous tests, we expect at least one franchise
    expect(res.body.length).toBeGreaterThan(0);
})

test('delete franchise', async () => {
    const newFranchise = { 
        name: 'Test Franchise ' + randomName(),
        admins: [{ email: admin.email }]  
      };
    const createRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newFranchise);
    expect(createRes.status).toBe(200);
    const franchiseId = createRes.body.id;

    const deleteRes = await request(app)
        .delete(`/api/franchise/${franchiseId}`)
        .set('Authorization', `Bearer ${adminAuthToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ message: 'franchise deleted' });
})

test('create store', async () => {
    const newFranchise = { 
        name: 'Test Franchise ' + randomName(),
        admins: [{ email: admin.email }]  
      };
    const createFranchiseRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newFranchise);
    expect(createFranchiseRes.status).toBe(200);
    const franchiseId = createFranchiseRes.body.id;

    const newStore = {
        name: 'Test Store ' + randomName(),
        address: '123 Test St',
        phone: '555-1234'
    };
    const createStoreRes = await request(app)
        .post(`/api/franchise/${franchiseId}/store`)
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newStore);
    expect(createStoreRes.status).toBe(200);
    expect(createStoreRes.body.name).toEqual(newStore.name);
}
)
test('delete store', async () => {
    const newFranchise = { 
        name: 'Test Franchise ' + randomName(),
        admins: [{ email: admin.email }]  
      };
    const createFranchiseRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newFranchise);
    expect(createFranchiseRes.status).toBe(200);
    const franchiseId = createFranchiseRes.body.id;

    const newStore = {
        name: 'Test Store ' + randomName(),
        address: '123 Test St',
        phone: '555-1234'
    };
    const createStoreRes = await request(app)
        .post(`/api/franchise/${franchiseId}/store`)
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newStore);
    expect(createStoreRes.status).toBe(200);
    const storeId = createStoreRes.body.id;

    const deleteStoreRes = await request(app)
        .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
        .set('Authorization', `Bearer ${adminAuthToken}`);
    expect(deleteStoreRes.status).toBe(200);
    expect(deleteStoreRes.body).toEqual({ message: 'store deleted' });
});


