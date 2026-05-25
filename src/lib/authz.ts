import { auth } from './auth';

/** Роли системы (хранятся в таблице Role; перечислены для подсказок IDE). */
export type RoleName =
  | 'ADMIN'
  | 'LOGISTICS_MANAGER'
  | 'LAAS_MANAGER'
  | 'OWN_DISPATCHER'
  | 'WAREHOUSE_OPERATOR'
  | 'RECEIVER_OPERATOR'
  | 'ACCOUNTANT'
  | 'VIEWER';

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  permissions: string[];
};

class AuthError extends Error {
  constructor(public code: 'UNAUTHENTICATED' | 'FORBIDDEN', message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Текущий пользователь из сессии (или null). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  const u = session.user as SessionUser;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roles: u.roles ?? [],
    permissions: u.permissions ?? [],
  };
}

/** Кидает UNAUTHENTICATED, если не залогинен. */
export async function requireAuth(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError('UNAUTHENTICATED', 'Требуется вход в систему');
  return u;
}

export function hasRole(user: SessionUser, roles: RoleName[]): boolean {
  return user.roles.some((r) => roles.includes(r as RoleName));
}

export function hasPermission(user: SessionUser, code: string): boolean {
  return user.permissions.includes(code);
}

/** Требует одну из ролей (ADMIN проходит всегда). */
export async function requireRole(roles: RoleName[]): Promise<SessionUser> {
  const u = await requireAuth();
  if (u.roles.includes('ADMIN')) return u;
  if (!hasRole(u, roles)) {
    throw new AuthError('FORBIDDEN', `Недостаточно прав (нужна роль: ${roles.join(' / ')})`);
  }
  return u;
}

/** Требует право по коду (ADMIN проходит всегда). */
export async function requirePermission(code: string): Promise<SessionUser> {
  const u = await requireAuth();
  if (u.roles.includes('ADMIN')) return u;
  if (!hasPermission(u, code)) {
    throw new AuthError('FORBIDDEN', `Недостаточно прав (нужно право: ${code})`);
  }
  return u;
}

/** ID текущего пользователя — для createdById / updatedById. */
export async function getActorId(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.id ?? null;
}

/**
 * Prisma-фильтр для скоупа рейсов по роли:
 * LAAS_MANAGER → только LAAS, OWN_DISPATCHER → только OWN,
 * ADMIN / LOGISTICS_MANAGER и прочие → без ограничения.
 */
export function tripTypeScopeFor(user: SessionUser): { tripType?: 'LAAS' | 'OWN' } {
  if (user.roles.includes('ADMIN') || user.roles.includes('LOGISTICS_MANAGER')) return {};
  const laas = user.roles.includes('LAAS_MANAGER');
  const own = user.roles.includes('OWN_DISPATCHER');
  if (laas && !own) return { tripType: 'LAAS' };
  if (own && !laas) return { tripType: 'OWN' };
  return {};
}

/** Проверка, может ли пользователь редактировать рейс данного типа. */
export function canEditTripType(user: SessionUser, tripType: 'OWN' | 'LAAS' | 'CONSOLIDATED'): boolean {
  const scope = tripTypeScopeFor(user);
  if (!scope.tripType) return true;
  return scope.tripType === tripType;
}
