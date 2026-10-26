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

export function signInSrp(email: string, password: string): Promise<Tokens> {
  const pool = new CognitoUserPool({ UserPoolId: config.poolId, ClientId: config.clientId });
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
    });
  });
}
