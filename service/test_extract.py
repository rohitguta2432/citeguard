"""Run with: .venv/bin/python test_extract.py"""

from main import extract, Brief

BRIEF = (
    "Miranda v. Arizona, 384 U.S. 436, 444 (1966). Id. at 467. "
    "Ashcroft v. Iqbal, 556 U.S. 662 (2009). See also 556 U.S. at 678. "
    "A dangling 410 U.S. at 153 with no antecedent."
)

cites = extract(Brief(text=BRIEF))["citations"]
by_raw = {c.raw: c for c in cites}

full, short = by_raw["384 U.S. 436"], by_raw["556 U.S. at 678"]

assert full.kind == "full" and full.page == "436" and full.pinCite == "444"
assert by_raw["Id."].claimedCase == "Miranda v. Arizona", "Id. must inherit its antecedent"

# The short form reads "at 678" but Iqbal starts on 662. Reporting 678 would
# 404 and brand a real case fabricated.
assert short.page == "662" and short.pinCite == "678"

# No antecedent means no guess: a wrong page is worse than no answer.
assert by_raw["410 U.S. at 153"].page is None

print(f"ok - {len(cites)} citations, short forms resolved")
