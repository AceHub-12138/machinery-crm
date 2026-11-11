// 自测只请求本机实例。账号从临时文件读取，凭据、会话和原始返回均不输出。
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const base = path.join(process.env.TEMP,"crm-acceptance");
const repo = path.resolve(__dirname,"../../../..");
const { id } = JSON.parse(fs.readFileSync(path.join(base,"run.json"),"utf8"));
assert.match(id,/^crm-accept-[a-f0-9]{20}$/);
const accounts = fs.readFileSync(path.join(base,"accounts.txt"),"utf8").trim().split(/\r?\n/).map(line=>line.split("\t"));
function local(args,input) {
  return execFileSync("docker",["--context","desktop-linux",...args],{input,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
}
function snapshot() {
  const sql = `SELECT quotaDate,used FROM lead_lookup_daily_quotas;
SELECT id,contactStatus,contactStatusUpdatedAt FROM leads WHERE id IN ('quota-single','quota-a','quota-b') ORDER BY id;
SELECT COUNT(*) AS all_lookup_rows FROM lead_contact_lookups;
SELECT COUNT(*) AS fixture_lookup_rows FROM lead_contact_lookups WHERE leadId IN ('quota-single','quota-a','quota-b') OR queryNameNormalized IN ('验收测试额度单查机械有限公司','验收测试额度批查甲机械有限公司','验收测试额度批查乙机械有限公司');`;
  return local(["exec","-i",id+"-db","sh","-c",'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -B -uroot crm_acceptance'],sql);
}
async function login(port, account) {
  const origin = "http://127.0.0.1:"+port;
  const cookies = new Map();
  async function request(url, init={}) {
    assert.ok(url.startsWith("/") && !url.startsWith("//"));
    const r=await fetch(origin+url,{...init,redirect:"manual",headers:{...init.headers,cookie:[...cookies].map(([k,v])=>k+"="+v).join("; ")}});
    for (const c of r.headers.getSetCookie()) { const pair=c.split(";")[0]; const i=pair.indexOf("="); cookies.set(pair.slice(0,i),pair.slice(i+1)); }
    return r;
  }
  const {csrfToken}=await (await request("/api/auth/csrf")).json();
  await request("/api/auth/callback/credentials",{method:"POST",body:new URLSearchParams({csrfToken,email:account[1],password:account[2]})});
  assert.equal((await (await request("/api/auth/session")).json()).user?.email,account[1]);
  return request;
}
async function main() {
  if (!fs.readFileSync(path.join(base,"guard.txt"),"utf8").includes("routes=0")) throw Error("未启用 3103");
  const before=snapshot();
  assert.match(before,/quota-single\s+PENDING_LOOKUP\s+NULL/);
  assert.match(before,/quota-a\s+PENDING_LOOKUP\s+NULL/);
  assert.match(before,/quota-b\s+PENDING_LOOKUP\s+NULL/);
  assert.match(before,/fixture_lookup_rows\s+0$/);
  console.log("正在核对 3103 登录、单条与批量接口。");
  const request=await login(3103,accounts[0]);
  const r=await request("/api/crm/leads/quota-single/contact-lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  assert.equal(r.status,429);
  const reason=(await r.json()).error;
  assert.equal(reason,"今日天眼查额度已用完（1/1）");
  const requested=[];
  const {runContactLookups}=require(path.join(repo,"src/modules/crm/leads/contact-client.ts"));
  await runContactLookups(["quota-a","quota-b"],row=>assert.equal(row.status,429),(url,init)=>{requested.push(url);return request(url,init);});
  assert.deepEqual(requested,["/api/crm/leads/quota-a/contact-lookup"]);
  assert.equal(before,snapshot());
  console.log("单条 HTTP 429："+reason+"\n批量：quota-a 返回 429；总请求 1；quota-b 请求 0。\n前后 SELECT 完全相同：\n"+before);
  const attempts=local(["exec",id+"-web3103","sh","-c","if test -f /tmp/acceptance-outbound; then wc -l < /tmp/acceptance-outbound; else echo 0; fi"]);
  assert.equal(attempts,"0");
  console.log("3103 防护日志：外部 HTTP 尝试 0。");
  console.log("正在核对 3101 的本地模型和实际只读工具。");
  for (const [i,expected] of [[0,8],[1,2]]) {
    const req=await login(3101,accounts[i]);
    for (const [word,n] of [["客户",expected],["合同",i===0?4:3]]) {
      const response=await req("/api/agent/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"我能查看多少条"+word+"？",thinkingTier:"fast"})});
      const stream=await response.text();
      assert.ok(response.ok && stream.includes("当前可见"+word+"共 "+n+" 条"),"小川本地只读查询 "+accounts[i][0]+word);
      console.log("3101 小川 "+accounts[i][0]+"："+word+" "+n);
    }
  }
  const prod=await login(3102,accounts[0]);
  const task=(await (await prod("/api/lead-hunter/tasks/candidate-task")).json()).task;
  const candidate=task.candidates[0];
  assert.equal(candidate.sourceUrl,"https://example.com/acceptance-source");
  assert.equal(candidate.score,85);
  assert.equal(candidate.phone,null);
  assert.equal(candidate.contactName,"验收联系人甲");
  const adminList=await (await prod("/api/crm/leads")).json();
  const summary=adminList.items.find(row=>row.id==="compare").latestContactLookup;
  assert.deepEqual(Object.keys(summary).sort(),["createdAt","isMock","reason","status"]);
  assert.equal(summary.reason,"验收预置人工复核样本");
  assert.equal(summary.status,"NEEDS_CONFIRM");
  assert.ok(!JSON.stringify(adminList).includes('"rawResponse"'));
  console.log("D3 超管列表：最近反查摘要仅含 status、reason、isMock、createdAt；无 rawResponse。");
  const rows=(await (await prod("/api/crm/leads/contact-lookups?status=NEEDS_CONFIRM")).json()).items;
  assert.ok(rows.some(row=>row.leadId==="no-name" && row.matchedName===null));
  assert.ok(rows.some(row=>row.leadId==="compare" && row.creditCode && row.rawResponse?.regLocation));
  for (const [i,expected] of [[1,"north"],[2,"south"],[3,"trade"]]) {
    const req=await login(3102,accounts[i]);
    const data=await (await req("/api/crm/leads")).json();
    assert.deepEqual(data.items.map(row=>row.id),[expected]);
    for (const row of data.items) {
      assert.ok(!Object.hasOwn(row,"latestContactLookup"));
      assert.ok(!Object.hasOwn(row,"contactLookups"));
    }
    assert.ok(!JSON.stringify(data).includes('"rawResponse"'));
    console.log("D3 "+accounts[i][0]+"列表：无 latestContactLookup、contactLookups、rawResponse 字段。");
  }
  console.log("3102 双待确认样本、85 分候选及三个角色各自的一条线索已核对。");
  assert.equal((await prod("/api/crm/leads/offline/contact-lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,503);
  console.log("3102 超管单条 HTTP 503。");
}
main().catch(e=>{console.error("抽查失败："+(e.message.includes("小川")?e.message:"请核对当前步骤与验收实例"));process.exitCode=1;});
