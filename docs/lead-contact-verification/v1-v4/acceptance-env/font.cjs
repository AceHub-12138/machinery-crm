// 验收构建沿用 Next 自带的 Geist 字体，无需访问字体服务。
const fs = require("node:fs");
const font = fs.readFileSync(require.resolve("next/dist/next-devtools/server/font/geist-latin.woff2")).toString("base64");
module.exports = {
  "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap":
    "@font-face{font-family:'Geist';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64," + font + ") format('woff2')}",
};
