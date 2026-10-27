"""Reading role tags onto member JSON. Stale IDs (deleted tags) are dropped on every read."""


def sort_key(tag):
    return tag['name'].casefold(), tag['tagId']


def tag_map(repo, k):
    """{tagId: name} for the Kehila's existing tags."""
    return {t['sk'][len('TAG#'):]: t['name'] for t in repo.list_tags(k)}


def tags_of(membership, names):
    """The membership's tags as [{tagId, name}] by name; IDs of deleted tags are dropped."""
    rows = [{'tagId': i, 'name': names[i]} for i in (membership.get('tagIds') or ()) if i in names]
    return sorted(rows, key=sort_key)


def with_tags(repo, k, rows, memberships):
    """Add `tags` to each row (same order as `memberships`); one read of the tag list, none when nobody has any."""
    names = tag_map(repo, k) if any(m.get('tagIds') for m in memberships) else {}
    for row, m in zip(rows, memberships):
        row['tags'] = tags_of(m, names)
    return rows
