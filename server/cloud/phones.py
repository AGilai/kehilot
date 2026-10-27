"""Phone numbers: one normaliser, E.164 out."""
import re

MAX_RAW = 32
_STRIP = re.compile(r'[ \-().]')
_ISRAELI = re.compile(r'^(?:[57]\d{8}|[23489]\d{7})$')
_OTHER = re.compile(r'^[1-9]\d{7,14}$')


def normalize_phone(raw):
    """E.164 string for an Israeli (local or +972) or international number, or None."""
    if not isinstance(raw, str) or len(raw) > MAX_RAW:
        return None
    text = _STRIP.sub('', raw)
    if text.startswith('00'):
        text = '+' + text[2:]
    if text.startswith('+'):
        digits = text[1:]
        if not (digits.isascii() and digits.isdigit()):
            return None
        if digits.startswith('972'):
            national = digits[3:]
            if national.startswith('0'):
                national = national[1:]
            return f'+972{national}' if _ISRAELI.fullmatch(national) else None
        return f'+{digits}' if _OTHER.fullmatch(digits) else None
    if text.startswith('0') and text.isascii() and text.isdigit() and _ISRAELI.fullmatch(text[1:]):
        return f'+972{text[1:]}'
    return None
