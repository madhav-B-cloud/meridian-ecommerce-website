'use strict';
/**
 * Auth service — mirrors microservices-ecommerce/auth-service.
 *
 * Same endpoints & payload shapes:
 *   POST /api/auth/register  {username, email, password}   -> 201
 *   POST /api/auth/login     {username, password}          -> LoginResponse
 *   POST /api/auth/refresh-token {refreshToken}            -> LoginResponse
 *   GET  /api/auth/me                                      -> UserInfo
 *   PUT  /api/auth/change-password {currentPassword, newPassword}
 *
 * LoginResponse: {accessToken, refreshToken, tokenType, expiresIn, user: UserInfo}
 * UserInfo:      {id, email, fullName, role}   (role: USER | ADMIN)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('../store');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRATION_MS = Number(process.env.JWT_EXPIRATION || 3600000); // 1h
const JWT_REFRESH_EXPIRATION_MS = Number(process.env.JWT_REFRESH_EXPIRATION || 86400000); // 24h

// Same password policy as auth-service RegisterRequest
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[@$!%*?&])[A-Za-z0-9@$!%*?&]{8,}$/;

const db = store.load('auth_db', { users: [], refreshTokens: [] });

function persist() { store.save('auth_db', db); }

function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: Math.floor(JWT_EXPIRATION_MS / 1000) }
  );
}

function issueRefreshToken(user) {
  const token = {
    id: crypto.randomUUID(),
    userId: user.id,
    token: crypto.randomBytes(40).toString('hex'),
    expiresAt: new Date(Date.now() + JWT_REFRESH_EXPIRATION_MS).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  db.refreshTokens.push(token);
  // rotate: revoke any other active tokens for this user
  db.refreshTokens.forEach(t => { if (t.userId === user.id && t.id !== token.id) t.revoked = true; });
  persist();
  return token.token;
}

function toUserInfo(user) {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

function loginResponse(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: issueRefreshToken(user),
    tokenType: 'Bearer',
    expiresIn: Math.floor(JWT_EXPIRATION_MS / 1000),
    user: toUserInfo(user),
  };
}

function register({ username, email, password, fullName }) {
  username = String(username || '').trim();
  email = String(email || '').trim().toLowerCase();

  if (!username || username.length < 3 || username.length > 50) {
    throw apiError('400', 'Username must be between 3 and 50 characters', 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw apiError('400', 'Email should be valid', 400);
  }
  if (!PASSWORD_PATTERN.test(password || '')) {
    throw apiError('400', 'Password must contain uppercase, digit, and special character (min 8 characters)', 400);
  }
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw apiError('USERNAME_TAKEN', 'Username is already taken', 409);
  }
  if (db.users.some(u => u.email === email)) {
    throw apiError('EMAIL_TAKEN', 'Email is already registered', 409);
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    email,
    fullName: (fullName && String(fullName).trim()) || username,
    role: 'USER',
    passwordHash: bcrypt.hashSync(password, 10),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  persist();
  return toUserInfo(user);
}

/** `username` accepts the username OR the email, for storefront convenience. */
function login({ username, password }) {
  const key = String(username || '').trim().toLowerCase();
  const user = db.users.find(u => u.username.toLowerCase() === key || u.email === key);
  if (!user || !user.enabled || !bcrypt.compareSync(password || '', user.passwordHash)) {
    throw apiError('BAD_CREDENTIALS', 'Invalid username or password', 401);
  }
  return loginResponse(user);
}

function refresh(refreshToken) {
  const token = db.refreshTokens.find(t => t.token === refreshToken && !t.revoked);
  if (!token || new Date(token.expiresAt) < new Date()) {
    throw apiError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired', 401);
  }
  const user = db.users.find(u => u.id === token.userId);
  if (!user) throw apiError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired', 401);
  return loginResponse(user);
}

function me(userId) {
  const user = db.users.find(u => u.id === userId);
  if (!user) throw apiError('404', 'User not found', 404);
  return toUserInfo(user);
}

function changePassword(userId, { currentPassword, newPassword }) {
  const user = db.users.find(u => u.id === userId);
  if (!user) throw apiError('404', 'User not found', 404);
  if (!bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    throw apiError('BAD_CREDENTIALS', 'Current password is incorrect', 400);
  }
  if (!PASSWORD_PATTERN.test(newPassword || '')) {
    throw apiError('400', 'Password must contain uppercase, digit, and special character (min 8 characters)', 400);
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  db.refreshTokens.forEach(t => { if (t.userId === userId) t.revoked = true; });
  persist();
  return { message: 'Password changed successfully' };
}

/** Verify an access token; returns {userId, username, role}. */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { userId: payload.sub, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

function countUsers() { return db.users.length; }

/** Used by the seeder only. */
function _createSeedUser(user) {
  user.passwordHash = bcrypt.hashSync(user.password, 10);
  user.enabled = true;
  delete user.password;
  db.users.push(user);
  persist();
}

module.exports = {
  register, login, refresh, me, changePassword,
  verifyAccessToken, countUsers, _createSeedUser,
};
