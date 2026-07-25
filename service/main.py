"""Citation extraction backed by eyecite, the Free Law Project's parser.

The TypeScript app carries its own regex extractor so CiteGuard runs with no
Python at all. This service is the upgrade: eyecite knows every reporter in the
Blue Book, resolves "Id." and "supra" back to the case they point at, and
returns pin cites. Start it and the app uses it; leave it stopped and nothing
breaks.
"""

from typing import Literal

from eyecite import get_citations, resolve_citations
from eyecite.models import (
    FullCaseCitation,
    IdCitation,
    ShortCaseCitation,
    SupraCitation,
)
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="CiteGuard extractor")

Kind = Literal["full", "short", "id", "supra"]

KINDS: list[tuple[type, Kind]] = [
    (FullCaseCitation, "full"),
    (ShortCaseCitation, "short"),
    (IdCitation, "id"),
    (SupraCitation, "supra"),
]


class Brief(BaseModel):
    text: str


class Citation(BaseModel):
    raw: str
    kind: Kind
    volume: str | None = None
    reporter: str | None = None
    page: str | None = None
    pinCite: str | None = None
    claimedCase: str | None = None
    index: int


def kind_of(c) -> Kind | None:
    for cls, name in KINDS:
        if isinstance(c, cls):
            return name
    return None


def case_name(c) -> str | None:
    """eyecite hands back the two parties separately, or a resolved name."""
    m = c.metadata
    full = getattr(m, "resolved_case_name", None)
    if full:
        return full
    plaintiff = (getattr(m, "plaintiff", None) or "").strip(" ,;")
    defendant = (getattr(m, "defendant", None) or "").strip(" ,;")
    if plaintiff and defendant:
        return f"{plaintiff} v. {defendant}"
    return getattr(m, "antecedent_guess", None) or None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "extractor": "eyecite"}


@app.post("/extract")
def extract(brief: Brief) -> dict[str, list[Citation]]:
    found = get_citations(brief.text)

    # Resolution walks the document so a bare "Id. at 164" inherits the case it
    # follows. Without it every short form looks like an unknown citation.
    # Clusters are keyed by a Resource wrapper; the full citation it stands for
    # is what carries the volume, reporter and party names.
    try:
        clusters = resolve_citations(found)
        resolved = {
            id(c): getattr(res, "citation", res)
            for res, cites in clusters.items()
            for c in cites
        }
    except Exception:
        resolved = {}

    out: list[Citation] = []
    for c in found:
        kind = kind_of(c)
        if kind is None:
            continue

        parent = resolved.get(id(c))
        parent_groups = (getattr(parent, "groups", None) or {}) if parent else {}

        # A short form's own "page" is the pin page, not the page the case
        # starts on: "556 U.S. at 678" is page 662 pinned at 678. Looking up 678
        # would 404 and brand a real case fabricated, so short forms take their
        # volume, reporter and page only from the full citation they resolve
        # back to. An unresolved short form reports nothing rather than a guess.
        groups = (getattr(c, "groups", None) or {}) if kind == "full" else parent_groups

        name = case_name(c)
        if not name and parent is not None:
            name = case_name(parent)

        out.append(
            Citation(
                raw=c.matched_text(),
                kind=kind,
                volume=groups.get("volume"),
                reporter=groups.get("reporter"),
                page=groups.get("page"),
                pinCite=getattr(c.metadata, "pin_cite", None),
                claimedCase=name,
                index=c.span()[0],
            )
        )
    return {"citations": out}
