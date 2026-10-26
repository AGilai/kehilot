import { config } from '../config.ts';

// Errors carry a code only. Never put emails, tokens or passwords in a message.
export class AuthError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

async function call(op: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${op}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('network');
  }
  let data: Record<string, any> = {};
  try {
    data = (await res.json()) ?? {};
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const type = typeof data.__type === 'string' ? data.__type : '';
    const code = type.split('#').pop() || 'unknown';
    throw new AuthError(code);
  }
  return data;
}

export async function signUp(email: string, password: string, lang: string): Promise<void> {
  await call('SignUp', {
    ClientId: config.clientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
    ClientMetadata: { lang },
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await call('ConfirmSignUp', { ClientId: config.clientId, Username: email, ConfirmationCode: code });
}

export async function resendCode(email: string, lang: string): Promise<void> {
  await call('ResendConfirmationCode', { ClientId: config.clientId, Username: email, ClientMetadata: { lang } });
}

export async function forgotPassword(email: string, lang: string): Promise<void> {
  await call('ForgotPassword', { ClientId: config.clientId, Username: email, ClientMetadata: { lang } });
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  await call('ConfirmForgotPassword', {
    ClientId: config.clientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
}

export async function refresh(refreshToken: string): Promise<{ idToken: string; expiresIn: number }> {
  const data = await call('InitiateAuth', {
    ClientId: config.clientId,
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  const r = data.AuthenticationResult;
  if (!r || typeof r.IdToken !== 'string') throw new AuthError('unknown');
  return { idToken: r.IdToken, expiresIn: Number(r.ExpiresIn) || 3600 };
}

export async function revoke(refreshToken: string): Promise<void> {
  await call('RevokeToken', { ClientId: config.clientId, Token: refreshToken });
}
