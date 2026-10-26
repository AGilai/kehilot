"""Time-sortable unique IDs (ULID format) for Kehilot, users and items."""
import re
import secrets
import time

_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
ID_RE = re.compile(r'^[0-9A-HJKMNP-TV-Z]{26}$')


def new_id():
    value = (time.time_ns() // 1_000_000) << 80 | int.from_bytes(secrets.token_bytes(10), 'big')
    chars = []
    for _ in range(26):
        chars.append(_ALPHABET[value & 31])
        value >>= 5
    return ''.join(reversed(chars))
