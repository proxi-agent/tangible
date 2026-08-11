/**
 * The read-only half of this package: what jurisdictions exist, what has been
 * loaded, and what caveats attach to each district's data.
 *
 * It is a separate entry point because the rest of the package is acquisition —
 * HTTP downloads, zip extraction, filesystem staging. A dashboard needs none of
 * that, and importing it drags yauzl and a pile of dynamic `fs` calls into the
 * bundle, which makes the build trace the whole project rather than the files
 * it actually uses.
 */
export * from './connectors/registry.js';
export * from './jurisdictions.js';
