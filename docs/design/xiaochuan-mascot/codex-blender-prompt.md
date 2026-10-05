# Codex 任务：用 Blender MCP 制作“小川”3D 吉祥物并导出网页用 GLB

## 任务背景

DachuanPro CRM 的 AI 助手“小川”需要一个专属 3D 形象，用于替换 Agent 首页目前的 Spline 占位机器人。
**本任务只负责在 Blender 中建模并导出资产文件，不要修改任何网页代码**——网页接入由后续单独任务完成。

## 参考资料（开工前必须先逐张读取）

1. 正面站姿主参考：`E:\Claude\machinery-crm-source\machinery-crm-v108-release\docs\design\xiaochuan-mascot\xiaochuan-front.png`
2. 挥手姿态参考：`E:\Claude\machinery-crm-source\machinery-crm-v108-release\docs\design\xiaochuan-mascot\xiaochuan-waving.png`
3. 十二宫格设定稿（造型 / 表情变体 / Logo 特写 / 官方色板）：`E:\Claude\machinery-crm-source\machinery-crm-v108-release\docs\design\xiaochuan-mascot\xiaochuan-spec-sheet.png`

以设定稿为唯一视觉基准。建模开始前，把“正面站姿”图作为参考图（Reference Image）放进 Blender 正交前视图，按图对齐比例。

## 造型规格（必须遵守）

- Q 版二头身悬浮机器人：圆角 TV 造型头部 + 白色躯干，**没有腿**，底部悬浮、躯干正下方有喷射火焰。
- 官方色板（设定稿第 12 格）：主橙 `#EE7D2C`、深灰 `#5B5C60`，配合白色机身、黑色屏幕脸、青色发光表情。
- 头顶橙色安全帽，帽正面有白色“D”形 Logo——**用参考图裁剪抠出的贴花贴图实现，不要建模几何 Logo**。
- 面部：黑色圆角屏幕 + 青色发光微笑表情，用**自发光（Emission）贴图**实现。
- 头部两侧：深灰耳罩，带橙色小按钮排（见参考图）。
- 胸前：橙灰双色“D”Logo 贴花（同样用贴图）。
- 手臂：黑色分节机械臂 + 橙色腕环 + 黑色手掌，左右各一；姿态按正面参考图（自然下垂微弯）。
- 底部：深灰悬浮舱底 + 橙黄色发光火焰锥体。
- 整体风格：低多边形圆润卡通（low-poly chibi / soft rounded），全模型三角形总量 ≤ 30000。

## 技术规格（网页交付硬要求）

- 朝向：模型正面朝 Blender 的 **-Y 方向**（即正视图看到的方向，与参考图对齐），Z 轴向上。这样导出 GLB 后正好面向网页观众（glTF +Z）。
- 比例：模型总高约 1.2 Blender 单位（米）；原点放在躯干垂直中心、水平居中。
- 命名：根节点 `XiaochuanRoot`；部件依次命名 `Head` / `Helmet` / `FaceScreen` / `EarL` / `EarR` / `Body` / `ArmL` / `ArmR` / `Thruster` / `Flame`。
- 材质：Principled BSDF；颜色严格按色板；金属度 ≈ 0，粗糙度 0.3–0.6，不要高反光塑料感；不需要法线贴图。
- 面部发光贴图：不透明 PNG，纯黑底 + 青色线条表情（青色从参考图取色）。
- 动画（**不需要骨骼绑定**，用父子级 + 关键帧即可）：
  - 必做：名为 `Idle` 的一条循环动画（约 3 秒），包含整体上下悬浮呼吸 + 轻微摇摆 + 火焰循环缩放闪烁，多通道合并在同一个 Action 里。
  - 可选加分：名为 `Wave` 的挥手循环动画（右臂举起左右挥动 1–2 秒循环）。
- 表情贴图：GLB 内嵌“微笑”作为默认表情；另单独导出三张面部贴图（1024×1024，不透明 PNG）：
  - `face_smile.png`（微笑，与 GLB 内嵌一致）
  - `face_thinking.png`（思考，参考设定稿第 10 格）
  - `face_wink.png`（眨眼，参考设定稿第 10 格）
- 导出设置：glTF Binary (.glb)，应用全部修改器，包含动画，纹理内嵌；**目标体积 < 3MB，硬上限 5MB**。

## 工作方式（通过 Blender MCP）

- 全程使用 Blender MCP 工具：获取场景信息、执行 Python 脚本、截取视口截图。
- 必须“截图 → 与参考图对比 → 修正”循环迭代，至少在以下四个节点各自查一次：头部完成时 / 整体形体完成时 / 材质贴图完成时 / 动画完成时。重点核对：二头身比例、色板颜色、头盔与胸前 Logo 位置、面部表情与设定稿一致、火焰位置居中。
- 工作目录（不存在则创建）：`E:\Claude\machinery-crm-source\xiaochuan-3d\`
  - `work\` 存 Blender 源文件 `xiaochuan.blend`（每完成一个阶段保存一次）。
  - `deliverables\` 存最终交付物。

## 最终交付物（全部放进 `E:\Claude\machinery-crm-source\xiaochuan-3d\deliverables\`）

1. `xiaochuan.glb`
2. `face_smile.png` / `face_thinking.png` / `face_wink.png`
3. 预览渲染图：`preview_front.png` / `preview_side.png` / `preview_45.png`（EEVEE 渲染，白底或透明底）

## 交付前自检（必须执行并汇报结果）

- 新建一个空场景，把 `xiaochuan.glb` 重新导入，截图确认模型、材质、动画全部正常（往返校验）。
- 在最终汇报中给出：三角形总量、GLB 文件体积（MB）、包含的动画名称列表、是否有超预算项。

## 禁止事项

- 不要修改 `E:\Claude\machinery-crm-source\machinery-crm-v108-release` 仓库内任何文件（参考图只读）。
- 不要在 Blender 中安装第三方插件或 Python 包。
- 不要联网下载任何素材，全部用参考图 + 程序化建模完成。
