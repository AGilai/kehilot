"""Pure family rules: no I/O."""

SEPARATOR = ' · '


def family_name(profiles):
    """Display name from the adults' profiles (adult order): each contributes the last name, or the first name
    when the last is empty; parts are de-duplicated in order. A missing profile counts as empty names."""
    parts = []
    for profile in profiles:
        profile = profile or {}
        part = (profile.get('lastName') or '').strip() or (profile.get('firstName') or '').strip()
        if part and part not in parts:
            parts.append(part)
    return SEPARATOR.join(parts)
