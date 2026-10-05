// 服务器端执行前确认原 PM2 名称、端口和可用内存；保留当前环境变量。
module.exports = {
  apps: [{
    name: process.env.PM2_APP || "machinery-crm",
    script: "start-standalone.cjs",
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "1200M",
    node_args: "--max-old-space-size=1024",
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      PORT: process.env.PORT || "3000",
    },
  }],
};
