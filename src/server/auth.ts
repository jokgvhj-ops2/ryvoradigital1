import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Secure Admin Passcode & Secret configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bsse5038';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'ryvora_admin_secure_token_secret_2026';
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AdminAuthResult {
  valid: boolean;
  message?: string;
}

/**
 * Timing-safe comparison of admin passcode
 */
export function verifyAdminPassword(submittedPasscode: string): boolean {
  if (!submittedPasscode || typeof submittedPasscode !== 'string') {
    return false;
  }
  const expected = Buffer.from(ADMIN_PASSWORD.trim());
  const actual = Buffer.from(submittedPasscode.trim());

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Creates an HMAC signed Bearer token for authenticated admin sessions
 */
export function generateAdminToken(): { token: string; expiresAt: number } {
  const timestamp = Date.now();
  const payload = `admin:${timestamp}`;
  const hmac = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('hex');

  const token = `ryv_${timestamp}_${hmac}`;
  return {
    token,
    expiresAt: timestamp + TOKEN_MAX_AGE_MS,
  };
}

/**
 * Validates a signed admin Bearer token
 */
export function validateAdminToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const parts = cleanToken.split('_');

  if (parts.length !== 3 || parts[0] !== 'ryv') {
    return false;
  }

  const timestamp = Number(parts[1]);
  const signature = parts[2];

  if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_MAX_AGE_MS) {
    return false; // Expired or invalid timestamp
  }

  const expectedPayload = `admin:${timestamp}`;
  const expectedHmac = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(expectedPayload)
    .digest('hex');

  try {
    const expectedBuf = Buffer.from(expectedHmac);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Express middleware to enforce admin authentication on protected endpoints
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || (req.headers['x-admin-token'] as string);

  if (!validateAdminToken(authHeader)) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized: Valid admin authentication token required.',
    });
    return;
  }

  next();
}
