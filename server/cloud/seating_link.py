"""Suggest which registered person a seat holder (no account) might be. Mirrors the normalization and ranking of
src/seats/match.ts; nothing is linked here: every result is a suggestion for a gabbai to confirm (the only automatic
link, routes_seatlink.auto_link_family, applies much stricter rules on top of match()).
A person is {lastName, firstNames: [..], phones: [..]} read from the profiles of a family's adults (or of one
membership requester)."""
import re
import unicodedata
from functools import lru_cache

_FINALS = str.maketrans('ךםןףץ', 'כמנפצ')
_NIQQUD = re.compile('[֑-ֽֿ-ׇ]')
_INVISIBLE = re.compile('[‎‏‪-‮⁦-⁩﻿​]')
_QUOTES = re.compile('[׳״\'"‘’“”`´]')
_DASHES = re.compile('[־\\-‐-―−]')
_PREFIX = re.compile(r'^(משפחת|משפחה|משפ|בית)\s+')
_TOP = 3

WHY = {'phone-surname': 6, 'surname-initial': 5, 'phone': 4, 'spelling': 3, 'surname-only': 2,
       'surname-other-initial': 1}


@lru_cache(maxsize=4096)
def normalize(text):
    s = unicodedata.normalize('NFKC', text or '')
    s = _INVISIBLE.sub('', _NIQQUD.sub('', s))
    s = _DASHES.sub(' ', _QUOTES.sub('', s)).translate(_FINALS)
    s = ''.join(c if c.isalnum() or c.isspace() else '' for c in s)
    return re.sub(r'\s+', ' ', s).strip().lower()


@lru_cache(maxsize=4096)
def _variants(name):
    n = normalize(name)
    stripped = _PREFIX.sub('', n)
    return (n, stripped) if stripped != n and stripped else (n,)


@lru_cache(maxsize=4096)
def spelling_key(name):
    out = []
    for w in normalize(name).split(' '):
        w = re.sub('[וי]', '', w)
        w = re.sub('[אה]$', '', w)
        out.append(re.sub(r'(.)\1+', r'\1', w))
    return ' '.join(out)


@lru_cache(maxsize=4096)
def _spelling_keys(name):
    return tuple(k for k in (spelling_key(v) for v in _variants(name)) if len(k.replace(' ', '')) >= 3)


@lru_cache(maxsize=4096)
def split_holder_name(name):
    """'בדיוני ש.' -> (surname variants, initial or '')."""
    tokens = normalize(name).split(' ')
    if len(tokens) >= 2 and re.fullmatch('[א-ת]', tokens[-1]):
        return _variants(' '.join(tokens[:-1])), tokens[-1]
    return _variants(' '.join(tokens)), ''


def digits(phone):
    return re.sub(r'[^0-9]', '', phone or '')[-9:]


def _same(a, b):
    return any(x and x in b for x in a)


def match(holder, person):
    """(why, level) of a holder ({name, phone?}) against a person, or None."""
    surnames, initial = split_holder_name(holder['name'])
    p_surnames = _variants(person.get('lastName') or '')
    same_surname = _same(surnames, p_surnames)
    same_spelling = not same_surname and _same([spelling_key(s) for s in surnames if len(spelling_key(s).replace(' ', '')) >= 3],
                                               _spelling_keys(person.get('lastName') or ''))
    hp = digits(holder.get('phone'))
    same_phone = len(hp) >= 7 and any(digits(p) == hp for p in person.get('phones') or ())
    initials = [normalize(f)[:1] for f in person.get('firstNames') or () if normalize(f)]
    if same_phone and (same_surname or same_spelling):
        return 'phone-surname', 'exact'
    if same_phone:
        return 'phone', 'likely'
    if same_surname and initial and initial in initials:
        return 'surname-initial', 'exact'
    if same_surname and initial and initials:
        return 'surname-other-initial', 'likely'
    if same_surname:
        return 'surname-only', 'likely'
    if same_spelling:
        return 'spelling', 'likely'
    return None


def surname_alike(holder_name, last_name):
    """A holder's surname and a person's surname are the same or spelling variants (the strictest 'could be them')."""
    p = _variants(last_name or '')
    if not any(p):
        return False
    s = split_holder_name(holder_name)[0]
    return _same(s, p) or bool(set(k for v in s for k in _spelling_keys(v)) & set(k for v in p for k in _spelling_keys(v)))


def holders_alike(a, b):
    """Two holder names share a surname (spelling variants included), whatever their initials."""
    return surname_alike(a, split_holder_name(b)[0][-1])


def suggest(holders, people):
    """people: {key: person}. Suggestions [{holderId, key, why, level}] best first, stable."""
    found = []
    for h in holders:
        for key, person in people.items():
            m = match(h, person)
            if m:
                found.append({'holderId': h['holderId'], 'key': key, 'why': m[0], 'level': m[1]})
    found.sort(key=lambda s: (-WHY[s['why']], s['holderId'], s['key']))
    return found


def top(items):
    return {'count': len(items), 'items': items[:_TOP]}
