"""Configurable SMS transport. No fixed/test codes or credential logging."""
import base64
import json
import os
import re
import urllib.parse
import urllib.request

from .validation import APIError


def settings():
    backend = os.environ.get('SHUL_SMS_BACKEND', '')
    sid = os.environ.get('TWILIO_ACCOUNT_SID', '')
    token = os.environ.get('TWILIO_AUTH_TOKEN', '')
    sender = os.environ.get('TWILIO_FROM_NUMBER', '')
    if backend != 'twilio' or not re.fullmatch(r'AC[0-9a-fA-F]{32}', sid) or not token or not sender:
        raise APIError(503, 'שליחת קודי SMS טרם הוגדרה. יש לפנות לגבאי.')
    return sid, token, sender


def send_code(phone, code):
    sid, token, sender = settings()
    body = urllib.parse.urlencode(dict(To=phone, From=sender,
        Body=f'קוד הכניסה לקהילה שלי: {code}. הקוד תקף ל־5 דקות.')).encode()
    authorization = base64.b64encode(f'{sid}:{token}'.encode()).decode()
    request = urllib.request.Request(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
        data=body, headers={'Authorization': 'Basic ' + authorization,
                            'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            result = json.load(response)
        if not result.get('sid') or result.get('status') in ('failed', 'undelivered'):
            raise ValueError('SMS rejected')
    except Exception:
        # Provider exceptions can contain the destination, code and credentials.
        raise APIError(503, 'שליחת הקוד נכשלה. נסו שוב מאוחר יותר.') from None
