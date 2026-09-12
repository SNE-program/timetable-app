/* 版本一致性检查：package.json 与 android/app/build.gradle 必须一致。
   手工改两处最容易漏一个 —— 漏了就会出现「关于页写 0.9.3、安装包其实是 0.9.2」
   这种最难查的问题。CI 里跑它，本地也能随时跑。 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');

const name = (/versionName\s+"([^"]+)"/.exec(gradle) || [])[1];
const code = (/versionCode\s+(\d+)/.exec(gradle) || [])[1];

if (!name || !code) {
  console.error('在 android/app/build.gradle 里找不到 versionName / versionCode');
  process.exit(1);
}
if (name !== pkg.version) {
  console.error('版本号不一致：package.json = ' + pkg.version + '，build.gradle versionName = ' + name);
  process.exit(1);
}
console.log('版本一致：' + pkg.version + '（versionCode ' + code + '）');
