// 内侧只接受 Unix 套接字，外侧只向同一固定端口的套接字转发。
const net = require("node:net");
const inside = process.argv[2] === "inside";
for (const port of [3101, 3102, 3306, ...(process.env.QUOTA_READY === "1" ? [3103] : [])]) {
  const socket = "/bridge/p" + port;
  const local = { host: "127.0.0.1", port };
  net.createServer(client => {
    const peer = net.connect(inside ? local : socket);
    peer.on("error", () => client.destroy());
    client.on("error", () => peer.destroy());
    client.on("close", () => peer.destroy());
    peer.on("close", () => client.destroy());
    client.pipe(peer).pipe(client);
  }).listen(inside ? socket : { host: "0.0.0.0", port });
}
