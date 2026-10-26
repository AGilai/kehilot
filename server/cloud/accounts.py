"""Cognito accounts pre-created by the list import. Nothing here logs or returns an email or a password."""
import functools
import secrets


@functools.cache
def cognito_client():
    import boto3
    return boto3.client('cognito-idp')


def _sub(attributes):
    return next(a['Value'] for a in attributes if a['Name'] == 'sub')


def _random_password():
    return secrets.token_urlsafe(32) + 'aA1!'


def _find(client, pool_id, email):
    """The user, or None. The pool uses username_attributes = [email], so the email is the username."""
    try:
        return client.admin_get_user(UserPoolId=pool_id, Username=email)
    except client.exceptions.UserNotFoundException:
        return None


def _normalise(client, pool_id, email, user):
    """Make a user who cannot use "forgot password" able to. A CONFIRMED user is never touched.

    An UNCONFIRMED user's password may have been chosen by whoever typed the email at sign-up, so it is always
    replaced by a random one nobody knows (otherwise confirming would hand them a live account).
    """
    status = user.get('UserStatus')
    if status not in ('FORCE_CHANGE_PASSWORD', 'RESET_REQUIRED', 'UNCONFIRMED'):
        return
    if status == 'UNCONFIRMED':
        client.admin_confirm_sign_up(UserPoolId=pool_id, Username=email)
    client.admin_set_user_password(UserPoolId=pool_id, Username=email, Permanent=True,
                                   Password=_random_password())
    client.admin_update_user_attributes(UserPoolId=pool_id, Username=email,
                                        UserAttributes=[{'Name': 'email_verified', 'Value': 'true'}])


def ensure_account(client, pool_id, email):
    """Return `(sub, created)`: the existing user, or a new CONFIRMED one with a random password nobody knows.

    The person signs in later through "forgot password" (a code by email) or Google/Apple. The password is
    created here, handed to Cognito and dropped: never stored, returned or logged.
    """
    email = email.strip().lower()
    user = _find(client, pool_id, email)
    if user:
        _normalise(client, pool_id, email, user)
        return _sub(user['UserAttributes']), False
    try:
        created = client.admin_create_user(
            UserPoolId=pool_id, Username=email, MessageAction='SUPPRESS',
            UserAttributes=[{'Name': 'email', 'Value': email}, {'Name': 'email_verified', 'Value': 'true'}])
    except client.exceptions.UsernameExistsException:  # created by a concurrent import or sign-up
        user = _find(client, pool_id, email)
        _normalise(client, pool_id, email, user)
        return _sub(user['UserAttributes']), False
    try:
        client.admin_set_user_password(UserPoolId=pool_id, Username=email, Permanent=True,
                                       Password=_random_password())
    except Exception:
        # a user left in FORCE_CHANGE_PASSWORD is repaired by the next import, but do not leave one if we can help it
        try:
            client.admin_delete_user(UserPoolId=pool_id, Username=email)
        except Exception:
            pass
        raise
    return _sub(created['User']['Attributes']), True
