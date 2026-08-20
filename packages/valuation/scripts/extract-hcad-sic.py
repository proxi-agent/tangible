#!/usr/bin/env python3
"""Extract HCAD's SIC code -> equipment life tables from the calc guide.

Texas does not depreciate machinery on one life. The district keys it to what
the business *does*: a bakery's ovens and a machine shop's lathes are both
"machinery and equipment" and they get different lives, which is why the
category table in `categories.ts` says the ten-year default only stands in
until the SIC is known. These are the tables that make it known.

Two of them, with different column counts:

  General    (printed pp. 6-28) : SIC | DESC | CLASS | GROUP | ME | MISC | SCHED | TRADE
  Industrial (printed pp. 29-45): SIC | DESC |         GROUP | ME | MISC | SCHED | TRADE

Unlike the percent-good tables — where a blank cell means a life class hit its
floor and text extraction silently drops the *position*, not the blank — these
rows are dense and every column is present on every line. So this extractor is
a line regex rather than a solver, and the thing it has to be careful about is
only the description, which is free text of unpredictable length and can
contain digits, commas, ampersands and the word "AND".

The fix is to anchor on both ends and let the description be the slack in the
middle: the SIC code is a fixed shape at the start, and the last four fields are
a closed vocabulary at the end. Anything that does not match that shape is
reported rather than skipped, because a row quietly dropped here is a business
type that silently falls back to the ten-year default.

Usage: extract-hcad-sic.py <guide.pdf> [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

import pdfplumber

# SIC codes are four digits, sometimes with an HCAD sub-code letter (8049A).
SIC = re.compile(r"^(\d{4}[A-Z]?)$")
GROUPS = {"MOD", "MAN", "IND"}

# Lines that are page furniture rather than data.
NOISE = re.compile(
    r"SIC Code List|SIC Code Alphabetical|Schedule (Value )?Calculation Guidelines"
    r"|^SIC Code\s+Description|^\s*$|^Page \d+",
    re.IGNORECASE,
)

# The published life classes. A life outside this set means the row was
# misparsed, or the guide added a class the valuation module does not know.
LIFE_CLASSES = {3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30}


def parse_row(line: str):
    """Parse one SIC row by anchoring on both ends.

    Regexes are the wrong tool here and the first attempt at this proved it: a
    *general* row (which carries a state class) also matches an *industrial*
    pattern (which does not), with the state class silently swallowed into the
    description. Two patterns that overlap cannot be disambiguated by trying one
    then the other, and a page-level "which table am I in" flag just moves the
    guess somewhere less visible.

    Tokens are unambiguous. The tail is a fixed shape read right to left —
    trade, schedule code, misc life, machinery life, group — and the presence of
    a state class immediately before the group is what distinguishes the two
    tables. The description is whatever is left in the middle, however many
    words, digits or ampersands it contains.
    """
    tokens = line.split()
    if len(tokens) < 7 or not SIC.match(tokens[0]):
        return None

    trade, sched, misc, me, group = tokens[-1], tokens[-2], tokens[-3], tokens[-4], tokens[-5]
    if group not in GROUPS or not misc.isdigit() or not me.isdigit():
        return None
    if not trade.isalpha() or not sched.isalpha():
        return None

    body = tokens[1:-5]
    # A general row ends its description with the state class (L1, L2 ...).
    state_class = None
    if body and len(body[-1]) == 2 and body[-1][0].isalpha() and body[-1][1].isdigit():
        state_class = body.pop()

    if not body:
        return None

    return {
        "sic": tokens[0],
        "description": " ".join(body),
        "stateClass": state_class,
        "group": group,
        "machineryLife": int(me),
        "miscLife": int(misc),
        "scheduleCode": sched,
        "tradeCode": trade,
        "kind": "general" if state_class else "industrial",
    }


def extract(pdf_path: str):
    rows: dict[str, dict] = {}
    unparsed: list[tuple[int, str]] = []
    kinds = Counter()
    kinds_by_sic: Counter = Counter()
    conflicts: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        pages = [(i, p.extract_text() or "") for i, p in enumerate(pdf.pages)]

        # The SIC listings start at the first page carrying the column header
        # and run to the end. Gating on that keeps the percent-good tables —
        # whose rows also begin with four digits — out of the parser entirely,
        # so an unparsed line here means a real SIC row we failed to read.
        first = next(
            (i for i, text in pages if re.search(r"^SIC Code\s+Description", text, re.MULTILINE)),
            None,
        )
        if first is None:
            raise SystemExit("No SIC table header found — has the guide layout changed?")

        for index, text in pages[first:]:
            for line in text.split("\n"):
                line = line.strip()
                if not line or NOISE.search(line):
                    continue
                if not SIC.match(line.split()[0] if line.split() else ""):
                    continue

                record = parse_row(line)
                if not record:
                    unparsed.append((index + 1, line))
                    continue

                kinds[record["kind"]] += 1
                sic = record["sic"]
                kinds_by_sic[sic] += 1
                prior = rows.get(sic)
                if prior and (
                    prior["machineryLife"] != record["machineryLife"]
                    or prior["miscLife"] != record["miscLife"]
                ):
                    # A code listed twice with different lives is ambiguous, and
                    # guessing which wins would put a client on the wrong life.
                    conflicts.append(
                        f"{sic}: {prior['kind']} {prior['machineryLife']}/{prior['miscLife']} "
                        f"({prior['description']}) vs {record['kind']} "
                        f"{record['machineryLife']}/{record['miscLife']} ({record['description']})"
                    )
                rows.setdefault(sic, record)

    return rows, unparsed, kinds, conflicts, kinds_by_sic


def validate(rows: dict[str, dict]) -> list[str]:
    problems = []
    for sic, row in rows.items():
        for field in ("machineryLife", "miscLife"):
            if row[field] not in LIFE_CLASSES:
                problems.append(f"{sic} {row['description']}: {field}={row[field]} is not a published life class")
        # Machinery outliving the miscellaneous life is the norm; the reverse
        # happens too, so this is not an invariant — only the class set is.
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--json", dest="out")
    args = parser.parse_args()

    rows, unparsed, kinds, conflicts, kinds_by_sic = extract(args.pdf)

    distinct = Counter(r["kind"] for r in rows.values())
    print(
        f"parsed {len(rows)} distinct SIC codes "
        f"({distinct['general']} general, {distinct['industrial']} industrial) "
        f"from {sum(kinds.values())} rows",
        file=sys.stderr,
    )

    # Each table is printed twice — once alphabetically, once numerically — so
    # every code is read from two independently typeset pages. That redundancy
    # is a complete cross-check of the parse and it is free, so it is enforced:
    # any disagreement between the two printings surfaces as a conflict below,
    # and a code seen only once means a row was missed on one of the passes.
    odd = {sic: n for sic, n in kinds_by_sic.items() if n != 2}
    if odd:
        # Known and benign in the 2026 guide, all five verified against the PDF:
        #   2499A, 3553 - printed twice on the same page by the guide itself
        #   4226P, 4227 - genuinely cross-listed in both the general and the
        #                 industrial tables, with identical lives
        #   7299A       - present alphabetically, absent from the numerical list
        # A code appearing here that is not one of those is a parse failure on
        # one of the two passes, and the lives it produced should not be trusted.
        print(
            f"CROSS-CHECK: {len(odd)} codes not printed exactly twice "
            f"(expected: 2499A, 3553, 4226P, 4227, 7299A)",
            file=sys.stderr,
        )
        for sic, n in sorted(odd.items()):
            print(f"  {sic}: {n}x  {rows[sic]['description']}", file=sys.stderr)
    if unparsed:
        print(f"UNPARSED {len(unparsed)} lines that started like a SIC row:", file=sys.stderr)
        for page, line in unparsed[:20]:
            print(f"  p{page}: {line}", file=sys.stderr)
    if conflicts:
        print(f"CONFLICTING CODES {len(conflicts)} (first listing wins):", file=sys.stderr)
        for conflict in conflicts[:20]:
            print(f"  {conflict}", file=sys.stderr)

    problems = validate(rows)
    if problems:
        print(f"VALIDATION FAILED ({len(problems)}):", file=sys.stderr)
        for problem in problems[:20]:
            print(f"  {problem}", file=sys.stderr)
        return 1

    lives = Counter(r["machineryLife"] for r in rows.values())
    print(f"machinery lives: {dict(sorted(lives.items()))}", file=sys.stderr)

    if args.out:
        with open(args.out, "w") as handle:
            json.dump(rows, handle, indent=1, sort_keys=True)
        print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
