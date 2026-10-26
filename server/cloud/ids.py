"""Time-sortable unique IDs (ULID format) for Kehilot, users and items."""
import re
import secrets
import time

_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
ID_RE = re.compile(r'^[0-9A-HJKMNP-TV-Z]{26}$')


def new_id():
    return _encode((time.time_ns() // 1_000_000) << 80 | int.from_bytes(secrets.token_bytes(10), 'big'))


def floor_id(ms):
    """The smallest ID for a millisecond timestamp: sorts before every real ID made in that millisecond."""
    return _encode(ms << 80)


def id_time_ms(value):
    """Milliseconds since the epoch encoded in the first 10 characters of a valid ULID."""
    out = 0
    for char in value[:10]:
        out = out << 5 | _ALPHABET.index(char)
    return out


def _encode(value):
    chars = []
    for _ in range(26):
        chars.append(_ALPHABET[value & 31])
        value >>= 5
    return ''.join(reversed(chars))
