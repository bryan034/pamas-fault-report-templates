"""Bounded, short-lived upload cache for previews only; drafts remain in PostgreSQL."""

from collections import OrderedDict
from threading import Lock
from time import monotonic
from uuid import uuid4
from fastapi import HTTPException

_assets = OrderedDict()
_lock = Lock()
MAX_BYTES = 64 * 1024 * 1024
TTL = 300


def put(template_id, revision_id, images):
    size = sum(len(item[0]) for item in images.values())
    token = str(uuid4())
    with _lock:
        for key in list(_assets):
            if monotonic() - _assets[key][0] > TTL:
                del _assets[key]
        while _assets and (
            len(_assets) >= 32
            or sum(item[4] for item in _assets.values()) + size > MAX_BYTES
        ):
            _assets.popitem(last=False)
        _assets[token] = (monotonic(), template_id, revision_id, images, size)
    return token


def get(token, template_id, revision_id):
    with _lock:
        item = _assets.get(token)
        if (
            not item
            or item[1:3] != (template_id, revision_id)
            or monotonic() - item[0] > TTL
        ):
            raise HTTPException(409, "Preview images expired; upload them again")
        _assets.move_to_end(token)
        return item[3]


def discard_template(template_id):
    """Forget cached photos when their template is permanently removed."""
    with _lock:
        for token in list(_assets):
            if _assets[token][1] == template_id:
                del _assets[token]
