"""Kehila logo validation. PNG only, read straight from the header (no image library)."""
import struct

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
MIN_SIDE, MAX_SIDE, MAX_BYTES = 64, 512, 65536


class LogoError(ValueError):
    """A logo that fails validation; `code` is the API error code (the CLI only shows the message)."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def validate_logo(data):
    """Return (width, height) of a valid logo PNG; raise LogoError (a ValueError) with a clear message otherwise."""
    if len(data) > MAX_BYTES:
        raise LogoError('logo_too_large', f'logo is {len(data)} bytes; the limit is {MAX_BYTES}')
    if not data.startswith(PNG_SIGNATURE):
        raise LogoError('logo_format', 'logo must be a PNG file')
    if len(data) < 33 or data[12:16] != b'IHDR':
        raise LogoError('logo_format', 'logo PNG header (IHDR) is missing or truncated')
    width, height = struct.unpack('>II', data[16:24])
    if width != height:
        raise LogoError('logo_not_square', f'logo must be square, got {width}x{height}')
    if not MIN_SIDE <= width <= MAX_SIDE:
        raise LogoError('logo_too_small' if width < MIN_SIDE else 'logo_too_large', f'logo side must be {MIN_SIDE} to {MAX_SIDE} pixels, got {width}')
    return width, height
