// Windows 入口由 PowerShell 调用；只向本机 Docker Desktop 的命名管道发指令。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { setTimeout: wait } = require("node:timers/promises");
const base = path.join(process.env.TEMP, "crm-acceptance");
const marker = path.join(base,"run.json");
const repo = path.resolve(__dirname,"../../../..");
const ports = [3101,3103,3102];
const context = ["--context","desktop-linux"];
function docker(args, stage, options = {}) {
  const { status, stdout } = spawnSync("docker", [...context,...args], {
    windowsHide:true, encoding:"utf8", maxBuffer:32*1024*1024, ...options,
  });
  if (status !== 0) throw Error(stage);
  return stdout.trim();
}
function localOnly() {
  const endpoint = docker(["context","inspect","desktop-linux","--format","{{.Endpoints.docker.Host}}"],"检查 Docker Desktop");
  if (!endpoint.startsWith("npipe:////./pipe/")) throw Error("需要本机 Docker Desktop");
}
function saved() {
  if (fs.lstatSync(base).isSymbolicLink()) throw Error("临时目录类型不符");
  const {id} = JSON.parse(fs.readFileSync(marker,"utf8"));
  if (!/^crm-accept-[a-f0-9]{20}$/.test(id)) throw Error("验收标记不符");
  return id;
}
function resources(id,kind) {
  return docker([kind,"ls",...(kind==="container"?["-a"]:[]),"--filter","label=crm.acceptance="+id,"--format",kind==="container"?"{{.Names}}":"{{.Name}}"],"列出资源").split(/\r?\n/).filter(Boolean);
}
function stop() {
  const id = saved();
  const containers = resources(id,"container").sort(n => n.endsWith("-db") ? 1 : -1);
  for (const n of containers) if (!n.endsWith("-db")) docker(["rm","-fv",n],"清理验收实例");
  if (containers.includes(id+"-db")) docker(["rm","-fv",id+"-db"],"清理测试库及匿名卷");
  for (const v of resources(id,"volume")) docker(["volume","rm",v],"清理验收数据卷");
  const tags = docker(["image","ls","--format","{{.Repository}}"],"核对验收镜像").split(/\r?\n/);
  if (tags.includes(id)) docker(["image","rm",id],"清理验收镜像标签");
  for (const name of ["accounts.txt","guard.txt","run.json"]) fs.rmSync(path.join(base,name), {force:true});
  fs.rmdirSync(base);
}
async function start() {
  if (fs.existsSync(base)) throw Error("已有验收目录，请先使用停止脚本");
  fs.mkdirSync(base);
  const id = "crm-accept-"+crypto.randomBytes(10).toString("hex");
  fs.writeFileSync(marker,JSON.stringify({id}),{flag:"wx"});
  const label = "crm.acceptance="+id;
  const name = suffix => id+"-"+suffix;
  const db = name("db");
  const scriptMount = ["--mount","type=bind,source="+__dirname+",target=/fixture,readonly"];
  const env = { MYSQL_ROOT_PASSWORD:crypto.randomBytes(30).toString("hex"), AUTH_SECRET:crypto.randomBytes(48).toString("hex") };
  env.DATABASE_URL = "mysql://root:"+env.MYSQL_ROOT_PASSWORD+"@127.0.0.1:3306/crm_acceptance";
  const options = {env:{...process.env,...env}};
  function run(suffix, args, image, cmd, persistent = true, opts = options) {
    return docker(["run",...(persistent?["-d"]:["--rm","-i"]),"--name",name(suffix),"--label",label,"--log-driver","none",
      ...args,image,...cmd],"启动或执行 "+suffix,opts);
  }
  console.log("正在构建本机验收镜像，首次运行可能需要数分钟。");
  docker(["build","--quiet","--pull=false","-t",id,"-f",path.join(__dirname,"Dockerfile"),repo],"验收镜像构建失败");
  for (const vol of ["bridge","uploads"]) docker(["volume","create","--label",label,name(vol)],"建立数据卷");
  run("db",["--network","none","-e","MYSQL_ROOT_PASSWORD","-e","MYSQL_DATABASE=crm_acceptance"],"mysql:5.7.44",
    ["--bind-address=127.0.0.1","--character-set-server=utf8mb4","--collation-server=utf8mb4_unicode_ci"]);
  let ready = false;
  for (let i=0;i<90;i++) {
    try {
      docker(["exec",db,"sh","-c",'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h127.0.0.1 -uroot crm_acceptance -e "SELECT 1"'],"等待数据库");
      ready = true; break;
    } catch { await wait(1000); }
  }
  if (!ready) throw Error("测试库未就绪");
  const isolated = ["--network","container:"+db,"--cap-drop=ALL","--security-opt=no-new-privileges",...scriptMount];
  const appEnv = ["-e","DATABASE_URL","-e","AUTH_SECRET","-e","AUTH_TRUST_HOST=true","-e","UPLOAD_DIR=/accepted-files",
    "-v",name("uploads")+":/accepted-files"];
  run("migrate",[...isolated,"-e","DATABASE_URL"],id,["node_modules/.bin/prisma","migrate","deploy"],false);
  const roles = ["超管","北区销售","南区销售","外贸","东区销售"];
  const accounts = roles.map((role,i)=>({role,email:"accept"+i+"@example.invalid",password:crypto.randomBytes(18).toString("base64url")}));
  run("seed",[...isolated,"-e","DATABASE_URL"],id,["node","/fixture/seed.cjs"],false,{...options,input:JSON.stringify(accounts)});
  let quota = true;
  let evidence;
  try { evidence = run("probe",isolated,id,["node","/fixture/guard.cjs"],false); }
  catch { quota = false; evidence = "隔离自测未通过，3103 未启动；批量 429 留待 V3 期间验收。"; }
  fs.writeFileSync(path.join(base,"guard.txt"),evidence+"\n");
  console.log(evidence);
  run("model",isolated,id,["node","/fixture/model.cjs"]);
  for (const port of ports.filter(p => p!==3103 || quota)) {
    const production = port===3102;
    run("web"+port,[...isolated,...appEnv,...(port===3103?["-e","NODE_OPTIONS=--require=/fixture/observe.cjs"]:[]),"-e","NODE_ENV="+(production?"production":"development"),
      "-e","AUTH_URL=http://127.0.0.1:"+port,"-e","NEXTAUTH_URL=http://127.0.0.1:"+port,
      "-e","LEAD_TYC_MOCK="+(port===3101?"1":"0"),"-e","LEAD_HUNTER_FAKE_SEARCH="+(production?"0":"1"),
      "-e","LEAD_TYC_TOKEN="+(port===3103?"acceptance-dummy-not-a-real-token":""),
      "-e","LEAD_TYC_DAILY_LIMIT="+(port===3103?"1":"20"),
      "-e","XIAOCHUAN_LLM_API_KEY=acceptance-local-only","-e","XIAOCHUAN_LLM_BASE_URL=http://127.0.0.1:3199/v1",
      "-e","XIAOCHUAN_LLM_MODEL=local-fixture"],id,
      ["node_modules/.bin/next",production?"start":"dev","-H","127.0.0.1","-p",String(port)]);
  }
  const bridge = ["-v",name("bridge")+":/bridge","-e","QUOTA_READY="+Number(quota)];
  run("inner",[...isolated,...bridge],id,["node","/fixture/bridge.cjs","inside"]);
  const bindings = ports.filter(p=>p!==3103 || quota).flatMap(p=>["-p","127.0.0.1:"+p+":"+p]);
  run("gateway",[...scriptMount,...bridge,...bindings,"-p","127.0.0.1::3306","--cap-drop=ALL"],"node:22-bookworm",["node","/fixture/bridge.cjs","outside"]);
  for (const p of ports.filter(p=>p!==3103 || quota)) {
    let ok=false;
    for (let i=0;i<60;i++) {
      try { const r=await fetch("http://127.0.0.1:"+p+"/api/auth/csrf",{signal:AbortSignal.timeout(15000)});
        if (r.ok && (await r.json()).csrfToken) { ok=true; break; } } catch {}
      await wait(1000);
    }
    if (!ok) throw Error("实例未就绪 "+p);
    console.log("已就绪 http://127.0.0.1:"+p);
  }
  fs.writeFileSync(path.join(base,"accounts.txt"),"\uFEFF"+accounts.map(a=>[a.role,a.email,a.password].join("\t")).join("\r\n"),{flag:"wx"});
  console.log("账号文件：%TEMP%\\crm-acceptance\\accounts.txt\n验收期间不要关闭本窗口。");
}
async function main() {
  localOnly();
  switch(process.argv[2]) {
    case "start": return start();
    case "list": {
      const id=saved();
      console.log([...resources(id,"container"),...resources(id,"volume"),id+"（专用镜像标签）","数据库匿名卷、账号文件和 %TEMP%\\crm-acceptance"].join("\n")); break;
    }
    case "stop": stop(); break;
    default: throw Error("请使用启动或停止脚本");
  }
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
