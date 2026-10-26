"""Cognito triggers: link a first Google/Apple sign-in to the native account with the same verified email, and
send the verification/reset emails in Hebrew or English.

Nothing here logs an email, a username or a provider id, and never `str(exception)` (Cognito messages can carry
the username). Only the trigger source, the outcome, and for AWS errors the error code and operation name.

Known Cognito behaviour: the first federated sign-in right after linking may fail with "already found an entry
for username"; the app retries once (Tasks 19/20). Apple relay addresses never match a pre-loaded person, and
Apple sends the email only on the first authorisation.
"""
import logging

from botocore.exceptions import ClientError

from . import accounts
from .errors import ApiError

logging.getLogger().setLevel(logging.INFO)  # Lambda leaves the root logger at WARNING and drops log.info
logger = logging.getLogger(__name__)

PROVIDERS = {'google': 'Google', 'signinwithapple': 'SignInWithApple'}

EMAIL_TEXT = {
    'CustomMessage_SignUp': {
        'he': ('אימות כתובת הדוא"ל בקהילות', 'קוד האימות שלך לקהילות: {####}'),
        'en': ('Verify your email for Kehilot', 'Your Kehilot verification code: {####}'),
    },
    'CustomMessage_ForgotPassword': {
        'he': ('איפוס סיסמה בקהילות', 'קוד לאיפוס הסיסמה בקהילות: {####}'),
        'en': ('Reset your Kehilot password', 'Your Kehilot password reset code: {####}'),
    },
}
EMAIL_TEXT['CustomMessage_ResendCode'] = EMAIL_TEXT['CustomMessage_SignUp']


def _link_external(event, client):
    provider_key, _, provider_id = event['userName'].partition('_')
    provider = PROVIDERS.get(provider_key.lower())
    if not provider or not provider_id:
        raise Exception('unsupported_provider')
    attributes = event['request'].get('userAttributes') or {}
    email = (attributes.get('email') or '').strip().lower()
    if not email:
        raise Exception('email_required')
    verified = str(attributes.get('email_verified')).lower()
    if verified == 'false' or (provider == 'Google' and verified != 'true'):  # Apple: absent is trusted
        raise Exception('email_unverified')
    pool_id = event['userPoolId']
    client = client or accounts.cognito_client()
    operation = 'EnsureAccount'
    try:
        # repairs an unverified/unconfirmed user; the native username in this pool is the sub
        sub, created = accounts.ensure_account(client, pool_id, email)
        operation = 'AdminLinkProviderForUser'
        client.admin_link_provider_for_user(
            UserPoolId=pool_id,
            DestinationUser={'ProviderName': 'Cognito', 'ProviderAttributeValue': sub},
            SourceUser={'ProviderName': provider, 'ProviderAttributeName': 'Cognito_Subject',
                        'ProviderAttributeValue': provider_id})
    except ClientError as exc:
        logger.error('trigger=%s outcome=aws_error operation=%s code=%s', event['triggerSource'],
                     exc.operation_name or operation, exc.response.get('Error', {}).get('Code'))
        raise Exception('link_failed') from None
    except ApiError as exc:
        logger.error('trigger=%s outcome=aws_error operation=%s code=%s', event['triggerSource'], operation,
                     exc.code)
        raise Exception('link_failed') from None
    except Exception as exc:  # BotoCoreError, ParamValidationError...: their text can carry the email
        logger.error('trigger=%s outcome=error operation=%s error=%s', event['triggerSource'], operation,
                     type(exc).__name__)
        raise Exception('link_failed') from None
    return 'created_and_linked' if created else 'linked'


def _custom_message(event, source):
    metadata = event['request'].get('clientMetadata') or {}
    lang = metadata.get('lang')
    subject, message = EMAIL_TEXT[source][lang if lang in ('he', 'en') else 'he']
    event['response']['emailSubject'] = subject
    event['response']['emailMessage'] = message.replace('{####}', event['request']['codeParameter'])
    return 'custom_message'


def handler(event, context, client=None):
    source = event.get('triggerSource')
    if source == 'PreSignUp_ExternalProvider':
        outcome = _link_external(event, client)
    elif source in EMAIL_TEXT:
        outcome = _custom_message(event, source)
    else:
        outcome = 'passthrough'
    logger.info('trigger=%s outcome=%s', source, outcome)
    return event
