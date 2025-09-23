const request = require('supertest');
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
}
)



