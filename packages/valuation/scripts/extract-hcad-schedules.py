"""
Extract HCAD's fixed depreciation schedules into structured JSON.

Both tables leave a cell blank once a life class reaches its floor, and plain
text extraction drops the blank rather than the position — so values cannot be
assigned to columns by counting tokens. The two tables need different handling
and neither is allowed to guess:

  * The general table's columns run shortest life to longest, and a shorter life
    always floors first, so its live columns are a suffix and values right-align
    onto them. That is verified afterwards against the one thing the data must
    satisfy — percent good never rises as an asset ages.
  * The computer/telecom table's columns are not in life order (PC and the
    4-year telecom schedule floor while the longer-lived SPC and mainframe
    columns still print), so its values are read by character position from a
    layout-preserving extraction instead.
"""

import json
import re
import sys

import pypdf

PDF = "2026-PP-Calc-Guide.pdf"
MAIN_PAGE, SPECIAL_PAGE = 4, 5

MAIN_LIVES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
SPECIAL_COLUMNS = ["pc", "spc", "mf", "telecom4", "telecom6", "telecom8", "solar10"]

reader = pypdf.PdfReader(PDF)


def data_lines(page_index, layout=False):
    mode = {"extraction_mode": "layout"} if layout else {}
    text = reader.pages[page_index].extract_text(**mode)
    for line in text.splitlines():
        if re.match(r"^\s*(19|20)\d{2}\s+\d\.\d{3}", line):
            yield line.rstrip()


# --------------------------------------------------------------------------
# General table: right-align onto the live suffix of life classes.
# --------------------------------------------------------------------------
main = {}
previous = {}

for line in data_lines(MAIN_PAGE, layout=True):
    year = int(line.strip()[:4])
    factor = float(re.search(r"\d\.\d{3}", line).group())
    after = line[line.index(f"{factor:.3f}") + 5 :]

    values = []
    for token in after.split():
        if not re.fullmatch(r"\d{1,3}", token):
            break
        values.append(int(token))

    # The guide prints its footnotes across the empty right-hand cells, which
    # hides the last live column on one row. A trailing integer there is that
    # column's value, and every earlier year is genuinely blank.
    if not values:
        trailing = re.search(r"(\d{1,3})\s*$", after)
        if trailing:
            values = [int(trailing.group(1))]

    mapping = dict(zip(MAIN_LIVES[len(MAIN_LIVES) - len(values) :], values)) if values else {}
    for life, value in mapping.items():
        if value > previous.get(life, 100):
            sys.exit(f"{year}: {life}-year percent good rose to {value} going back in time")
        previous[life] = value

    main[year] = {"indexFactor": factor, "percentGood": mapping}

# --------------------------------------------------------------------------
# Computer / telecom / solar table: read by column position.
# --------------------------------------------------------------------------
special = {}
anchors = None

for line in data_lines(SPECIAL_PAGE, layout=True):
    year = int(line.strip()[:4])
    factor = float(re.search(r"\d\.\d{3}", line).group())
    after_at = line.index(f"{factor:.3f}") + 5
    cells = [(m.start(), int(m.group())) for m in re.finditer(r"\b\d{1,3}\b", line[after_at:])]

    if anchors is None:
        # The newest year prints every column, so it defines where each sits.
        if len(cells) != len(SPECIAL_COLUMNS):
            sys.exit(f"{year}: expected {len(SPECIAL_COLUMNS)} columns, found {len(cells)}")
        anchors = [position for position, _ in cells]
        mapping = dict(zip(SPECIAL_COLUMNS, [value for _, value in cells]))
    else:
        mapping = {}
        for position, value in cells:
            nearest = min(range(len(anchors)), key=lambda i: abs(anchors[i] - position))
            if abs(anchors[nearest] - position) > 6:
                sys.exit(f"{year}: value {value} at {position} matches no column")
            column = SPECIAL_COLUMNS[nearest]
            if column in mapping:
                sys.exit(f"{year}: two values landed in column {column}")
            mapping[column] = value

    for column, value in mapping.items():
        if value > previous.get(f"s:{column}", 100):
            sys.exit(f"{year}: {column} percent good rose to {value} going back in time")
        previous[f"s:{column}"] = value

    special[year] = {"indexFactor": factor, "percentGood": mapping}

print("general table — every year, percent good by life class:")
for year in sorted(main, reverse=True):
    row = main[year]
    if row["percentGood"]:
        print(f"  {year} x{row['indexFactor']:.3f} {row['percentGood']}")
    else:
        print(f"  {year} x{row['indexFactor']:.3f} (all classes at floor)")

print("\ncomputer / telecom / solar table:")
for year in sorted(special, reverse=True):
    print(f"  {year} {special[year]['percentGood']}")

json.dump({"main": main, "special": special}, open("schedules-2026.json", "w"), indent=2, sort_keys=True)
print("\nwrote schedules-2026.json")
