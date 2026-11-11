// 只记录外部 HTTP 尝试次数。内核网络命名空间独立负责阻断。
const fs = require("node:fs");
const diagnostics = require("node:diagnostics_channel");
function record(hostname) {
  if (!["localhost","127.0.0.1","[::1]"].includes(hostname)) fs.appendFileSync("/tmp/acceptance-outbound","attempt\n");
}
diagnostics.channel("undici:request:create").subscribe(({request}) => record(new URL(request.origin).hostname));
diagnostics.channel("http.client.request.start").subscribe(({request}) => {
  const dest = String(request.getHeader("host") ?? "localhost");
  record(new URL("http://"+dest).hostname);
});
