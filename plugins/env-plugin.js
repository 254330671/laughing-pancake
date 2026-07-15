// env 插件：让源码可以 `import { HOME, USER } from 'env'`，
// 变量的值在构建时从 process.env 读取并内联进产物。
//
// 用法：
//   plugins: [envPlugin()]                          // 内联全部环境变量（慎用，可能泄漏敏感信息）
//   plugins: [envPlugin({ only: ['USER', 'HOME'] })] // 只内联白名单里的变量
//
// 白名单里列出但环境里不存在的变量会被内联为 null，保证命名导入总能解析。
function envPlugin({ only } = {}) {
  // 白名单事关是否把整个 process.env 写进产物，传错类型必须报错而不是静默忽略
  if (only !== undefined && !Array.isArray(only)) {
    throw new TypeError(
      `envPlugin: "only" 必须是字符串数组，收到了 ${typeof only}。` +
        `请写 envPlugin({ only: ['USER'] })，而不是 envPlugin({ only: 'USER' })`
    );
  }

  return {
    name: 'env',
    setup(build) {
      // 把裸导入 'env' 标记到独立的 namespace，避免 esbuild 去 node_modules 找它
      build.onResolve({ filter: /^env$/ }, (args) => ({
        path: args.path,
        namespace: 'env-ns',
      }));

      // 用 JSON loader 把选中的环境变量作为模块内容返回
      build.onLoad({ filter: /.*/, namespace: 'env-ns' }, () => {
        let vars = process.env;
        if (only) {
          // 无原型对象，避免 '__proto__' 这类键名触发原型 setter 而丢失
          vars = Object.create(null);
          for (const key of only) {
            vars[key] = Object.prototype.hasOwnProperty.call(process.env, key)
              ? process.env[key]
              : null;
          }
        }
        return {
          contents: JSON.stringify(vars),
          loader: 'json',
        };
      });
    },
  };
}

module.exports = envPlugin;
