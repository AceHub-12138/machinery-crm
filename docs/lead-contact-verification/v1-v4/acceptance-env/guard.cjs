const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
async function main() {
  if (Object.keys(os.networkInterfaces()).some(n => n !== "lo")) throw Error("存在非回环接口");
  if (fs.readFileSync("/proc/net/route","utf8").trim().split("\n").length !== 1) throw Error("存在网络路由");
  console.log("interfaces=lo; IPv4 routes=0");
  for (const host of ["open.api.tianyancha.com", "192.0.2.1", "2001:db8::1"]) {
    await new Promise((resolve,reject) => {
      const s = net.connect(443, host);
      s.setTimeout(12000, () => s.destroy(new Error("timeout")));
      s.once("connect", () => { s.destroy(); reject(Error("连接成功")); });
      s.once("error", e => {
        if (!["ENETUNREACH","EHOSTUNREACH","ENOTFOUND","EAI_AGAIN"].includes(e.code)) return reject(e);
        console.log(host + ":443 denied " + e.code); resolve();
      });
    });
  }
}
main().catch(() => { process.exitCode = 1; });
