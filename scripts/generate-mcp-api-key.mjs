import { createHash, randomBytes } from "node:crypto";

const secret = `dcp_mcp_${randomBytes(32).toString("base64url")}`;
const keyHash = createHash("sha256").update(secret).digest("hex");

console.log(`API_KEY=${secret}`);
console.log(`KEY_HASH=${keyHash}`);
console.log("请仅把 KEY_HASH 写入服务端环境变量；API_KEY 只在 FastGPT 中配置并妥善保管。");
