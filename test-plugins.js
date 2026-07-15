// 两个插件的测试：node test-plugins.js（或 npm test）
const assert = require('node:assert');
const esbuild = require('esbuild');
const envPlugin = require('./plugins/env-plugin');
const buildLogPlugin = require('./plugins/build-log-plugin');

async function testEnvInline() {
  process.env.PLUGIN_TEST_VALUE = 'it-works-12345';

  const result = await esbuild.build({
    stdin: {
      contents: `import { PLUGIN_TEST_VALUE } from 'env'; console.log(PLUGIN_TEST_VALUE);`,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    plugins: [envPlugin({ only: ['PLUGIN_TEST_VALUE'] })],
  });

  const code = result.outputFiles[0].text;
  assert.ok(code.includes('it-works-12345'), 'env 插件应把变量的值内联进产物');
  console.log('✓ env 插件：构建时内联环境变量');
}

async function testEnvWhitelist() {
  process.env.PLUGIN_TEST_VALUE = 'it-works-12345';

  // 用默认导入拿到整个 env 对象：命名导入会被 esbuild tree-shake 成单个常量，
  // 即使白名单坏了产物里也看不到其他变量，断言会形同虚设
  const result = await esbuild.build({
    stdin: {
      contents: `import env from 'env'; console.log(JSON.stringify(env));`,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    plugins: [envPlugin({ only: ['PLUGIN_TEST_VALUE'] })],
  });

  const code = result.outputFiles[0].text;
  assert.ok(code.includes('it-works-12345'), '白名单里的变量应被内联');
  // esbuild 会把合法标识符的键写成不带引号的形式，所以按裸词匹配
  assert.ok(!/\bPATH\b/.test(code), '白名单外的变量（如 PATH）不应出现在产物里');
  console.log('✓ env 插件：白名单外的变量不会进入产物');
}

async function testEnvMissingVarIsNull() {
  delete process.env.PLUGIN_TEST_MISSING;

  const result = await esbuild.build({
    stdin: {
      contents: `import { PLUGIN_TEST_MISSING } from 'env'; console.log(PLUGIN_TEST_MISSING);`,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    plugins: [envPlugin({ only: ['PLUGIN_TEST_MISSING'] })],
  });

  const code = result.outputFiles[0].text;
  assert.ok(code.includes('null'), '白名单里缺失的变量应内联为 null 而不是构建失败');
  console.log('✓ env 插件：缺失的白名单变量内联为 null');
}

function testEnvRejectsNonArrayOnly() {
  assert.throws(
    () => envPlugin({ only: 'USER' }),
    TypeError,
    'only 传非数组时应报错，而不是静默内联全部环境变量'
  );
  console.log('✓ env 插件：only 传非数组时抛出 TypeError');
}

async function testBuildLogPlugin() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  let result;
  try {
    result = await esbuild.build({
      stdin: {
        contents: `console.log('hi');`,
        resolveDir: __dirname,
      },
      bundle: true,
      write: false,
      plugins: [buildLogPlugin({ tag: 'test' })],
    });
  } finally {
    console.log = originalLog;
  }

  assert.ok(result.metafile, '插件应自动开启 metafile 以获取产物大小');
  assert.ok(logs.some((l) => l.includes('[test] 构建开始')), '应打印构建开始日志');
  assert.ok(logs.some((l) => l.includes('[test] 构建完成')), '应打印构建完成日志');
  console.log('✓ build-log 插件：打印开始/完成日志并拿到产物大小');
}

async function testBuildLogDoesNotMutateOptions() {
  const originalLog = console.log;
  console.log = () => {};

  const optsNoMetafile = {
    stdin: { contents: `console.log('hi');`, resolveDir: __dirname },
    bundle: true,
    write: false,
    plugins: [buildLogPlugin({ tag: 'test' })],
  };
  const optsMetafileFalse = {
    stdin: { contents: `console.log('hi');`, resolveDir: __dirname },
    bundle: true,
    write: false,
    metafile: false,
    plugins: [buildLogPlugin({ tag: 'test' })],
  };

  let resultFalse;
  try {
    await esbuild.build(optsNoMetafile);
    resultFalse = await esbuild.build(optsMetafileFalse);
  } finally {
    console.log = originalLog;
  }

  assert.ok(!('metafile' in optsNoMetafile), '构建结束后应还原调用方的 options 对象');
  assert.strictEqual(optsMetafileFalse.metafile, false, '不应覆盖用户显式设置的 metafile: false');
  assert.ok(!resultFalse.metafile, 'metafile: false 时不应产生 metafile');
  console.log('✓ build-log 插件：不永久改写 options，尊重显式 metafile: false');
}

async function main() {
  await testEnvInline();
  await testEnvWhitelist();
  await testEnvMissingVarIsNull();
  testEnvRejectsNonArrayOnly();
  await testBuildLogPlugin();
  await testBuildLogDoesNotMutateOptions();
  console.log('全部测试通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
