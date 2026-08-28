/**
 * Which release of the detectors produced a report.
 *
 * Hand-bumped, and deliberately not derived. A hash over this package's source
 * would be exact and useless: it moves when a comment is reworded, so within a
 * month every stored run differs from every other one and the field stops
 * carrying information. What a reader actually needs to know is whether the
 * *findings* would come out differently, and only a person can answer that.
 *
 * Bump the minor when a detector is added or removed, or when one's threshold,
 * basis or effect changes. Bump the patch when a finding's wording changes —
 * the summary and basis are quoted to taxpayers and appear in filed positions,
 * so a reworded basis is a real difference between two reports even though no
 * number moved. Refactors that cannot change output do not bump anything.
 *
 * Written onto every `analysis_runs` row. A published report is only
 * reproducible if it records which arithmetic ran, and the input fingerprint —
 * which covers the client's side — cannot see ours moving at all.
 */
export const SAVINGS_RULES_VERSION = '1.2.0';
