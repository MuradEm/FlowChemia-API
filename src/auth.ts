import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { Database } from './database.js';
import { tokenHash, verifyPassword, newToken, hashPassword } from './password.js';

export type AuthRequest = Request & { actor: { userId: string; sessionId: string } };

@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private dummyHash = hashPassword('not-a-real-account-password');
  constructor(private readonly db: Database) {}

  throttle(key: string) {
    const now = Date.now();
    // Bounded, process-local limiter. Distributed deployments need a shared store.
    if (this.attempts.size >= 10000) for (const [k,v] of this.attempts) if (v.resetAt <= now) this.attempts.delete(k);
    if (this.attempts.size >= 10000 && !this.attempts.has(key)) throw new HttpException('Try again later', 429);
    let entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) { entry = {count: 0, resetAt: now + 60000}; this.attempts.set(key, entry); }
    if (++entry.count > 10) throw new HttpException('Try again later', 429);
  }

  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({where: {email}, include: {credential: true}});
    const valid = await verifyPassword(password, user?.credential?.passwordHash ?? await this.dummyHash);
    if (!user?.credential || !valid) throw new UnauthorizedException('Invalid email or password');
    const token = newToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.db.session.create({data: {userId: user.id, tokenHash: tokenHash(token), expiresAt}});
    return {token, expiresAt, user: {id: user.id, displayName: user.displayName}};
  }

  async authenticate(authorization: string | undefined) {
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new UnauthorizedException();
    const session = await this.db.session.findUnique({where: {tokenHash: tokenHash(authorization.slice(7))}});
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException();
    return {userId: session.userId, sessionId: session.id};
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    request.actor = await this.auth.authenticate(request.headers.authorization);
    return true;
  }
}
