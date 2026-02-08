import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts', 'src/cli.ts'],
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],          // vscode is provided by the host
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  minify: false,                  // keep readable for debugging
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('watching for changes…');
} else {
  await esbuild.build(buildOptions);
}
