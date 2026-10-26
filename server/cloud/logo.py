"""Kehila logo validation. PNG only, read straight from the header (no image library)."""
import struct

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
MIN_SIDE, MAX_SIDE, MAX_BYTES = 64, 512, 65536


def validate_logo(data):
    """Return (width, height) of a valid logo PNG; raise ValueError with a clear message otherwise."""
    if len(data) > MAX_BYTES:
        raise ValueError(f'logo is {len(data)} bytes; the limit is {MAX_BYTES}')
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError('logo must be a PNG file')
    if len(data) < 33 or data[12:16] != b'IHDR':
        raise ValueError('logo PNG header (IHDR) is missing or truncated')
    width, height = struct.unpack('>II', data[16:24])
    if width != height:
        raise ValueError(f'logo must be square, got {width}x{height}')
    if not MIN_SIDE <= width <= MAX_SIDE:
        raise ValueError(f'logo side must be {MIN_SIDE} to {MAX_SIDE} pixels, got {width}')
    return width, height
