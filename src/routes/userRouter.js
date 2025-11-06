const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');
const metrics = require('../metrics.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'GET',
    path: '/api/user?page=1&limit=10&name=*',
    requiresAuth: true,
    description: 'Gets a list of users',
    example: `curl -X GET localhost:3000/api/user -H 'Authorization: Bearer tttttt'`,
    response: {
      users: [
        {
          id: 1,
          name: '常用名字',
          email: 'a@jwt.com',
          roles: [{ role: 'admin' }],
        },
      ],
    },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
];

// getUser
userRouter.get(
  '/me',metrics.requestTracker('/api/user/me'),
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// updateUser
userRouter.put(
  '/:userId',metrics.requestTracker('/api/user/:userId'),
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  })
);


userRouter.get(
  '/',metrics.requestTracker('/api/user'),
  authRouter.authenticateToken, // ensures req.user exists or 401s
  asyncHandler(async (req, res) => {
    // Be defensive in case isRole isn't attached for some reason:
    const hasIsRole = typeof req.user?.isRole === 'function';
    const isAdmin =
      hasIsRole
        ? req.user.isRole(Role.Admin)
        : Array.isArray(req.user?.roles) && req.user.roles.some(r => r.role === Role.Admin);

    if (!isAdmin) {
      // Return 403 directly instead of throwing
      return res.status(403).json({ message: 'forbidden' });
    }

    const page  = Number(req.query.page ?? 0) || 0;
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 10) || 10, 100));
    const name  = (req.query.name ?? '*').toString();

    const result = await DB.getAllUsers({ page, limit, name }); // { users, more }
    return res.json(result);
  })
);

userRouter.delete(
  '/:userId',metrics.requestTracker('/api/user/:userId'),
  authRouter.authenticateToken, // 401 if not logged in
  asyncHandler(async (req, res) => {
    // robust admin check (works even if isRole missing)
    const isAdmin = typeof req.user?.isRole === 'function'
      ? req.user.isRole(Role.Admin)
      : Array.isArray(req.user?.roles) && req.user.roles.some(r => r.role === Role.Admin);

    if (!isAdmin) {
      return res.status(403).json({ message: 'forbidden' });
    }

    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: 'invalid user id' });
    }

    const affected = await DB.deleteUser(userId);
    if (!affected) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({ message: 'user deleted' });
  })
);



module.exports = userRouter;
