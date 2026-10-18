"""Shared helpers for the venue format-check engine."""
import copy
import hashlib
from dataclasses import dataclass, asdict

TO_PT = {"pt": 1.0, "in": 72.0, "cm": 72.0 / 2.54, "mm": 72.0 / 25.4}


@dataclass
class Finding:
    id: str
    status: str          # pass | fail | warn | manual | skip
    title: str
    detail: str = ""
    location: str = ""
    fix: str = ""
    source: str = ""

    def to_dict(self):
        return asdict(self)


def finding(rid, ok, title, detail="", location="", fix="", source="", severity="error"):
    """ok=True -> pass; otherwise fail (severity=error) or warn (severity=warn)."""
    status = "pass" if ok else ("fail" if severity == "error" else "warn")
    return Finding(rid, status, title, detail, location, fix, source)


def to_pt(value, unit="pt"):
    return float(value) * TO_PT[unit]


def margins_pt(m):
    """{"unit":"in","top":1,...} -> {"top":72,...} (only keys present)."""
    if not m:
        return None
    unit = m.get("unit", "in")
    return {k: to_pt(m[k], unit) for k in ("top", "bottom", "left", "right") if m.get(k) is not None}


def deep_merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def sources(block):
    return (block or {}).get("_sources", {}) or {}


def sha256_normalized(path):
    data = open(path, "rb").read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()
