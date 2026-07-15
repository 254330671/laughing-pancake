# laughing-pancake

一个用 esbuild 打包的小项目，附带两个自定义 esbuild 插件。

## 插件

### 1. env 插件（`plugins/env-plugin.js`）

让源码可以直接从 `'env'` 导入环境变量，值在**构建时**被内联进产物：

```js
import { USER, HOME } from 'env';
console.log(USER, HOME);
```

```js
const envPlugin = require('./plugins/env-plugin');

await esbuild.build({
  // ...
  plugins: [
    envPlugin(),                          // 内联全部环境变量（慎用）
    // envPlugin({ only: ['USER', 'HOME'] }) // 推荐：只内联白名单里的变量
  ],
});
```

行为说明：

- 白名单里列出但环境里不存在的变量会被内联为 `null`（而不是构建失败），请在代码里自行兜底，如 `USER || '朋友'`。
- `only` 传了非数组（比如误写成 `only: 'USER'`）会直接抛 `TypeError`，不会静默退回全量内联。

> 注意：不加 `only` 白名单会把整个 `process.env` 写进产物，可能泄漏敏感信息，发布产物时请务必使用白名单。

### 2. 构建日志插件（`plugins/build-log-plugin.js`）

打印每次构建的耗时、产物文件大小、错误/警告数量：

```js
const buildLogPlugin = require('./plugins/build-log-plugin');

await esbuild.build({
  // ...
  plugins: [buildLogPlugin({ tag: 'my-app' })], // tag 可选，自定义日志前缀
});
```

产物大小来自 esbuild 的 metafile：你没设置时插件会临时开启并在构建结束后还原（不会永久改写你的 options 对象）；你显式设置 `metafile: false` 时插件予以尊重，只是不打印大小。

输出示例：

```
[my-app] 构建开始…
[my-app]   out.js  57 字节
[my-app] 构建完成，耗时 8ms，0 个错误，0 个警告
```

## 使用

```bash
npm install
npm run build   # 打包 test.js -> out.js，example.js -> example.out.js
npm test        # 运行两个插件的测试
node example.out.js
```
