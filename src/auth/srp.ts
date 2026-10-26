import { CognitoUser, CognitoUserPool, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { config } from '../config.ts';
import { AuthError } from './cognito.ts';
import type { Tokens } from './tokens.ts';

const KNOWN = new Set([
  'UsernameExistsException', 'CodeMismatchException', 'ExpiredCodeException', 'NotAuthorizedException',
  'UserNotConfirmedException', 'InvalidPasswordException', 'LimitExceededException',
]);

function mapError(err: unknown): AuthError {
  const e = err as { code?: string; name?: string } | null;
  const code = e?.code ?? e?.name ?? '';
  if (KNOWN.has(code)) return new AuthError(code);
  if (code === 'NetworkError' || code === 'TypeError') return new AuthError('network');
  return new AuthError(code || 'unknown');
}

// The library persists tokens and the email in its Storage. Give it a throwaway in-memory one.
export function createMemoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

export function createPool(storage: Storage, poolId = config.poolId, clientId = config.clientId): CognitoUserPool {
  return new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId, Storage: storage });
}

export function signInSrp(email: string, password: string): Promise<Tokens> {
  const pool = createPool(createMemoryStorage());
  const user = new CognitoUser({ Username: email, Pool: pool });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve({
        idToken: session.getIdToken().getJwtToken(),
        refreshToken: session.getRefreshToken().getToken(),
        expiresAt: session.getIdToken().getExpiration() * 1000,
      }),
      onFailure: (err) => reject(mapError(err)),
      newPasswordRequired: () => reject(new AuthError('NotAuthorizedException')),
      mfaRequired: () => reject(new AuthError('NotAuthorizedException')),
      totpRequired: () => reject(new AuthError('NotAuthorizedException')),
      customChallenge: () => reject(new AuthError('NotAuthorizedException')),
      selectMFAType: () => reject(new AuthError('NotAuthorizedException')),
    });
  });
}
