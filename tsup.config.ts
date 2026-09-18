import { defineConfig } from 'tsup';

// Two separate configs because `minify` is per-config: the ESM build stays
// readable (and carries the type declarations), the IIFE bundle is minified
// for plain <script> use. `clean` is negated for the global bundle because
// the configs build in parallel and a bare `clean: true` can delete the other
// config's output.
export default defineConfig([
  {
    entry: { 'glass-button': 'src/glass-button.ts' },
    format: ['esm'],
    dts: true,
    clean: ['!glass-button.global.js'],
    outExtension() {
      return { js: '.js' };
    },
  },
  {
    entry: { 'glass-button': 'src/glass-button.ts' },
    format: ['iife'],
    globalName: 'GlassButtonModule',
    minify: true,
    outExtension() {
      return { js: '.global.js' };
    },
  },
]);
