"""Consent wording versions (the one place) and reading consent records."""

VERSIONS = {'age13': '2026-10-27', 'phoneList': '2026-10-28', 'kehilaTerms': '2026-10-27'}


def latest(items, kind, kehila=None):
    """The newest consent item (by SK, a ULID) of `kind`, for `kehila` when given; None when there is none."""
    found = [i for i in items if i.get('kind') == kind and (kehila is None or i.get('kehilaId') == kehila)]
    return max(found, key=lambda i: i['sk']) if found else None
