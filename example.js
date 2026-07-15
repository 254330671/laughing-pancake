// 演示 env 插件：这两个值在构建时就被内联进 example.out.js
import { USER, HOME } from 'env';

console.log(`你好 ${USER || '朋友'}，你的主目录是 ${HOME || '（未设置）'}`);
