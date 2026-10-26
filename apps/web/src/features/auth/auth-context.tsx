import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthService } from './auth-service';
import type { AuthState } from './guard';

const AuthContext = createContext<AuthService | null>(null);

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  return <AuthContext.Provider value={service}>{children}</AuthContext.Provider>;
}

export function useAuthService(): AuthService {
  const service = useContext(AuthContext);
  if (!service) throw new Error('AuthProvider missing');
  return service;
}

export function useAuth(): AuthState {
  const service = useAuthService();
  return useSyncExternalStore(service.subscribe, service.getSnapshot);
}

/**
 * Sign out and reload the app: a full page load is the only reliable way to drop every file,
 * result and worker of the previous session from memory.
 */
export async function signOutAndReload(service: AuthService): Promise<void> {
  await service.signOut();
  window.location.assign('/login?reason=signedOut');
}
