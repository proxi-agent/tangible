/**
 * Vercel's function entry point.
 *
 * Plain JavaScript on purpose. Vercel's Node builder transpiles a TypeScript
 * entry itself, using the nearest `tsconfig.json` — which here is the app's,
 * whose `types: ["node"]` it then fails to resolve from the deployment root
 * (`TS2688: Cannot find type definition file for 'node'`). Pointing at the
 * already-compiled `dist/` sidesteps that compiler entirely: the build has run
 * by the time this file is traced, and swc has done the work with the tsconfig
 * that was written for it.
 */
export { default } from '../dist/serverless.js';
