// 模型只选择两个内置只读工具，数量始终来自 CRM 返回的当前角色分页总数。
const http = require("node:http");
http.createServer(async (req,res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks));
    const last = messages.at(-1);
    const ask = messages.findLast(m => m.role === "user");
    const contract = String(ask?.content).includes("合同");
    const tool = contract ? "crm_contracts_list" : "crm_customers_list";
    const label = contract ? "合同" : "客户";
    res.writeHead(200, { "Content-Type":"text/event-stream" });
    const event = (delta, finish_reason = null) => res.write("data: " + JSON.stringify({choices:[{delta,finish_reason}]}) + "\n\n");
    if (last.role === "tool") {
      const total = JSON.parse(last.content).data?.pagination?.total;
      event({content: Number.isInteger(total) ? "当前可见" + label + "共 " + total + " 条。" : "只读工具未返回数量。"});
      event({}, "stop");
    } else {
      event({tool_calls:[{index:0,id:"local-call",type:"function",function:{name:tool,arguments:'{"page":1,"pageSize":1}'}}]});
      event({}, "tool_calls");
    }
    res.end("data: [DONE]\n\n");
  } catch { res.end(); }
}).listen(3199,"127.0.0.1");
