"""Message types and the Kehila's per-type rules: normalization, defaults and which types a person may post.

The decisions themselves (who may post, who may see) are made in visibility.py, which consumes `rules`."""

TYPES = ('weekly', 'event', 'general', 'celebration', 'condolence')
CONFIGURABLE = ('celebration', 'condolence')  # the only types whose rules the Kehila can change
POST_WHO = ('management', 'broadcasters')
DEFAULT_RULE = {'post': 'broadcasters', 'listeners': False}


def rules(settings):
    """`{celebration: {post, listeners}, condolence: {...}}` from a Kehila's settings. Anything missing or
    malformed reads as the default, never as "allow". A fresh dict on every call."""
    stored = settings.get('typeRules') if isinstance(settings, dict) else None
    stored = stored if isinstance(stored, dict) else {}
    out = {}
    for type_ in CONFIGURABLE:
        rule = stored.get(type_)
        rule = rule if isinstance(rule, dict) else {}
        post, listeners = rule.get('post'), rule.get('listeners')
        out[type_] = {'post': post if post in POST_WHO else DEFAULT_RULE['post'],
                      'listeners': listeners if isinstance(listeners, bool) else DEFAULT_RULE['listeners']}
    return out


def postable_types(membership, channel, rules):
    """The types this person may post in this channel, in TYPES order; [] for a conversation channel."""
    from . import visibility  # visibility imports this module for its defaults
    if not channel or channel.get('conversation'):
        return []
    return [t for t in TYPES if visibility.can_post(membership, channel, t, rules)]
