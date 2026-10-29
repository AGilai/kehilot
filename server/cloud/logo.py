"""Kehila logo validation. PNG only, read straight from the header (no image library)."""
import struct
import zlib

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
    _check_chunks(data)
    return width, height


def _check_chunks(data):
    """Walk the chunks: IHDR first (length 13), every length fits and every CRC is right, at least one IDAT,
    IEND last with nothing after it."""
    pos, seen_idat, first = len(PNG_SIGNATURE), False, True
    while True:
        if pos + 12 > len(data):
            raise LogoError('logo_format', 'logo PNG is truncated (no IEND chunk)')
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > len(data):
            raise LogoError('logo_format', 'logo PNG chunk is longer than the file')
        if first and (kind != b'IHDR' or length != 13):
            raise LogoError('logo_format', 'logo PNG header (IHDR) is missing or malformed')
        first = False
        if struct.unpack('>I', data[end - 4:end])[0] != zlib.crc32(data[pos + 4:end - 4]):
            raise LogoError('logo_format', 'logo PNG has a chunk with a wrong checksum')
        seen_idat = seen_idat or kind == b'IDAT'
        pos = end
        if kind == b'IEND':
            break
    if not seen_idat:
        raise LogoError('logo_format', 'logo PNG has no image data')
    if pos != len(data):
        raise LogoError('logo_format', 'logo PNG has data after its end')
