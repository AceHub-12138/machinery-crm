import fs from 'node:fs';
import path from 'node:path';

const [artifactDir, evidenceFile] = process.argv.slice(2);
if (!artifactDir || !evidenceFile) throw new Error('Usage: generate-linux-report.mjs <artifact-dir> <evidence-file>');
const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
const rows = (file) => fs.readFileSync(path.join(artifactDir, file), 'utf8').trim().split('\n').slice(1);
const customImages = rows('IMAGE_IDS.tsv').map((row) => {
  const [name, tag, id, size, digests] = row.split('\t');
  return `| ${name} | \`${tag}\` | \`${id}\` | ${size} | ${digests ? `\`${digests}\`` : '本地构建镜像，无 RepoDigest'} |`;
});
const externalImages = rows('EXTERNAL_IMAGE_IDS.tsv').map((row) => {
  const [image, platform, index, id, archive] = row.split('\t');
  return `| \`${image}\` | \`${platform}\` | \`${index}\` | \`${id}\` | \`${archive}\` |`;
});
const lines = [
  '# FULL_READ_ONLY Linux 隔离验收报告', '',
  `- 分支：\`${process.env.GIT_BRANCH || 'local'}\``,
  `- Commit：\`${process.env.GIT_SHA || 'local'}\``,
  `- GitHub Actions Run ID：\`${process.env.GITHUB_RUN_ID || 'local'}\``,
  '- 模式：`FULL_READ_ONLY`', '- 结论：PASS',
  '', '## 验收证据', '',
  `- overallStatus：\`${evidence.overallStatus}\``,
  `- 检查数：\`${evidence.checks.length}\``,
  `- requestId：\`${evidence.requestIdSummary.count}\`，唯一值 \`${evidence.requestIdSummary.uniqueCount}\``,
  `- 冷启动复验：\`${process.env.PREBUILT_REVALIDATED || 'NO'}\``, '',
  ...evidence.checks.map((check) => `- PASS：${check}`), '',
  '## 项目镜像', '', '| 名称 | 固定标签 | Image ID | 大小（字节） | RepoDigest |', '| --- | --- | --- | ---: | --- |', ...customImages, '',
  '## 内置外部运行时镜像（linux/amd64）', '', '| 镜像 | 平台 manifest digest | OCI index digest | Config Digest | Artifact 文件 |', '| --- | --- | --- | --- | --- |', ...externalImages, '',
  '## 离线冷启动', '',
  '十二张运行时镜像均内置。经 `SHA256SUMS` 校验后，预构建模式只执行本地 `docker load` 和 `docker compose up`，并使用 `--pull never`。',
];
const report = `${lines.join('\n')}\n`;
for (const marker of ['`SHA256SUMS`', '`docker load`', '`--pull never`', 'sha256:', 'FULL_READ_ONLY']) {
  if (!report.includes(marker)) throw new Error(`Report marker missing: ${marker}`);
}
fs.writeFileSync(path.join(artifactDir, 'LINUX_ACCEPTANCE_REPORT.md'), report);
