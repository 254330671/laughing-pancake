// 构建日志插件：打印每次构建的耗时、产物文件大小、错误/警告数量。
//
// 用法：
//   plugins: [buildLogPlugin()]
//   plugins: [buildLogPlugin({ tag: 'my-app' })] // 自定义日志前缀
//
// 产物大小来自 metafile：用户未设置时插件临时开启并在构建结束后还原，
// 用户显式设置 metafile: false 时予以尊重（只是不打印大小）。
function buildLogPlugin({ tag = 'build-log' } = {}) {
  return {
    name: 'build-log',
    setup(build) {
      const opts = build.initialOptions;
      // initialOptions 就是调用方传给 esbuild 的那个对象，不能永久改写它
      const forcedMetafile = opts.metafile === undefined;
      if (forcedMetafile) opts.metafile = true;

      let startedAt;
      build.onStart(() => {
        startedAt = Date.now();
        console.log(`[${tag}] 构建开始…`);
      });

      build.onEnd((result) => {
        if (forcedMetafile) delete opts.metafile;

        const ms = Date.now() - startedAt;
        const outputs = result.metafile ? Object.entries(result.metafile.outputs) : [];
        for (const [file, info] of outputs) {
          console.log(`[${tag}]   ${file}  ${info.bytes} 字节`);
        }
        console.log(
          `[${tag}] 构建完成，耗时 ${ms}ms，` +
            `${result.errors.length} 个错误，${result.warnings.length} 个警告`
        );
      });
    },
  };
}

module.exports = buildLogPlugin;
