"""Push notifications. Task 7 replaces the body; callers use this signature."""


def enqueue(kind, kehila, ref) -> None:
    """Queue a push of `kind` ('message' | 'reply' | 'request') for `kehila`. No-op until Task 7."""
