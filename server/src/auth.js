import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRY = '5d';
const AUTH_CACHE_MS = 30_000;
const AUTH_CACHE_MAX = 500;
const authCache = new Map();

function cacheUser(token, user) {
  if (authCache.size >= AUTH_CACHE_MAX) {
    const oldest = authCache.keys().next().value;
    authCache.delete(oldest);
  }
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_MS });
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.user = cached.user;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db
      .prepare(
        `SELECT id, name, email, role, manager_id, active FROM users WHERE id = ?`
      )
      .get(payload.id);
    if (!user || !(user.active === true || user.active === 1 || user.active === '1')) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }
    req.user = user;
    cacheUser(token, user);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function hrRequired(req, res, next) {
  if (req.user?.role !== 'hr') {
    return res.status(403).json({ error: 'HR access required' });
  }
  next();
}

export function managerRequired(req, res, next) {
  if (req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'Manager access required' });
  }
  next();
}

export function managerOrHrRequired(req, res, next) {
  if (!['manager', 'hr'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Manager or HR access required' });
  }
  next();
}
