"""Cognito accounts pre-created by the list import. Nothing here logs or returns an email or a password."""
import functools
import secrets


@functools.cache
def cognito_client():
    import boto3
    return boto3.client('cognito-idp')


def _sub(user):
    return next(a['Value'] for a in user['UserAttributes'] if a['Name'] == 'sub')


def _find(client, pool_id, email):
    """The user's sub, or None. The pool uses username_attributes = [email], so the email is the username."""
    try:
        return _sub(client.admin_get_user(UserPoolId=pool_id, Username=email))
    except client.exceptions.UserNotFoundException:
        return None


def ensure_account(client, pool_id, email):
    """Return `(sub, created)`: the existing user, or a new CONFIRMED one with a random password nobody knows.

    The person signs in later through "forgot password" (a code by email) or Google/Apple. The password is
    created here, handed to Cognito and dropped: never stored, returned or logged.
    """
    sub = _find(client, pool_id, email)
    if sub:
        return sub, False
    try:
        client.admin_create_user(UserPoolId=pool_id, Username=email, MessageAction='SUPPRESS',
                                 UserAttributes=[{'Name': 'email', 'Value': email},
                                                 {'Name': 'email_verified', 'Value': 'true'}])
    except client.exceptions.UsernameExistsException:  # created by a concurrent import or sign-up
        return _find(client, pool_id, email), False
    try:
        client.admin_set_user_password(UserPoolId=pool_id, Username=email, Permanent=True,
                                       Password=secrets.token_urlsafe(32) + 'aA1!')
    except Exception:
        # a user left in FORCE_CHANGE_PASSWORD could never be fixed by a re-import: remove it, a retry starts clean
        try:
            client.admin_delete_user(UserPoolId=pool_id, Username=email)
        except Exception:
            pass
        raise
    return _find(client, pool_id, email), True
