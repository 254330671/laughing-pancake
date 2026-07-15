// 构建脚本：用两个自定义插件打包 test.js 和 example.js
const esbuild = require('esbuild');
const envPlugin = require('./plugins/env-plugin');
const buildLogPlugin = require('./plugins/build-log-plugin');

async function main() {
  // 原有入口：test.js -> out.js（test.js 不用环境变量，不挂 env 插件，
  // 避免日后误加 `import env from 'env'` 时把整个环境写进产物）
  await esbuild.build({
    entryPoints: ['test.js'],
    bundle: true,
    outfile: 'out.js',
    plugins: [buildLogPlugin({ tag: 'out.js' })],
  });

  // 演示 env 插件的入口：example.js -> example.out.js
  await esbuild.build({
    entryPoints: ['example.js'],
    bundle: true,
    outfile: 'example.out.js',
    plugins: [envPlugin({ only: ['USER', 'HOME'] }), buildLogPlugin({ tag: 'example' })],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
