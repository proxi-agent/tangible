# Rebuilding a schedule from the district's PDF

The schedules under `src/schedules/` are committed data, not parsed at runtime.
These two scripts are how they were produced, kept so next year's guide can be
loaded the same way and the diff reviewed.

```bash
curl -O https://hcad.org/assets/uploads/pdf/resources/2027/2027-PP-Calc-Guide.pdf
python3 extract-hcad-schedules.py     # -> schedules-2027.json
python3 emit-schedule-module.py       # -> tx-harris-2027.ts
```

Both need `pypdf`. Move the emitted module into `src/schedules/`, add it to
`src/registry.ts`, and update the spot values in `src/appraise.test.ts` — those
assertions are read off the printed page on purpose, so they fail loudly if a
transcription drifts.

## Why extraction is not a one-liner

Both tables leave a cell blank once a life class reaches its floor, and text
extraction drops the blank rather than the position. Values therefore cannot be
assigned to columns by counting tokens, and the two tables fail differently:

- The **general table** runs shortest life to longest, and a shorter life always
  floors first, so its live columns are a suffix and values right-align onto
  them. The script verifies that afterwards against the one property the data
  must have — percent good never rises as an asset ages — and stops if it does.
- The **computer, specific-equipment and industrial telecom/solar table** is not
  in life order: personal computers and the 4-year telecom schedule floor while
  the longer-lived specific-equipment and mainframe columns are still printing.
  Right-alignment silently produces wrong factors there, and the monotonic
  constraint alone leaves four assignments fitting the 2020 row. So that table
  is read by character position from a layout-preserving extraction, with each
  value matched to the column the newest row establishes.

The guide also prints its footnotes across the empty right-hand cells, which
hides one real value (1994's 30-year factor) behind note text and puts stray
numbers where percent-good values would sit. The script takes only a leading run
of bare integers, then looks for a trailing integer to recover that last cell.
