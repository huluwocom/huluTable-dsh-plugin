# 开源前检查清单

在把本仓库推送到 GitHub 公开前，逐项核对。已完成项打勾；带 ⚠️ 的项需要仓库所有者在上线前确认。

## 法律与协议

- [x] `LICENSE`：MIT，版权年份 2025，版权主体 `huluTable contributors`。
- [x] 第三方依赖许可：`clsx`（MIT）、`recharts`（MIT）、`xlsx / SheetJS`（Apache-2.0），见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。运行时依赖全部为宽松许可证，可商用、可再分发。
- [x] 源码不含第三方拷贝粘贴片段；CSS/图标均为自绘或系统图标，无版权素材。
- [x] 模板数据为虚构样例（陈小雨/李浩然…），不含真实个人信息。
- [ ] ⚠️ 如未来引入非 MIT/Apache/BSD 依赖，需重新评估并更新 THIRD_PARTY_NOTICES。

## 敏感信息

- [x] 无 API Key / token / 密码：数据全部保存在用户浏览器 IndexedDB，插件不发起任何网络请求。
- [x] 无硬编码个人路径（已全库扫描 `/Users/…`）。
- [x] 截图使用虚构样例数据，不含敏感内容。
- [x] `.gitignore` 覆盖 `node_modules/`、`lib/`、`coverage/`、`.env*`、`.DS_Store`、日志。

## 仓库卫生

- [x] 无 `.DS_Store`、无大文件残留；`git status` 应干净（初始化提交后）。
- [x] `releases/*.tgz` 为交付产物（安装组合包），有意纳入版本控制并附带 SHA-256。
- [x] `lib/` 不提交：`prepare`/`build` 按需生成（npm 发布时构建、git 安装时自动构建、tarball 预构建）。
- [x] `package.json` 中 `repository` / `bugs` / `homepage` 已指向 `https://github.com/huluwocom/HuluTable`。

## 工程质量

- [x] 构建自包含：`pnpm install` + `prepare` 即可产出 `lib/`（无 monorepo 依赖）。
- [x] 构建期 purity 门禁：跨插件的非法值导入直接构建失败。
- [x] 测试套件完整（48 个文件 / 486 用例，100% 行/分支/函数/语句覆盖率），链接 SDK 后 `pnpm test` 可跑。
- [x] lint（oxlint）与类型检查（tsc）脚本齐备。
- [x] CI：`.github/workflows/ci.yml` 覆盖构建（无需 SDK）+ 测试（检出 harness 链接 SDK）。
- [x] 语义化版本：当前 `0.1.0`；发布后按 SemVer 递增，破坏性变更升 major。

## 兼容性声明

- [x] 明确要求 DeepSeek Harness 环境与 `dsh` CLI；README 给出三种安装路径（本地 / git / tarball）。
- [x] `cordis.patch.yml` 的「禁用内置行 + 插入独立行」策略已用 `dsh --dump-config` 验证（禁用内置 `ui-hulutable`，插入 `hulutable → dsh-hulutable-plugin`）。
- [ ] ⚠️ 若上游 `dsh-web-app` 未来删除内置 `ui-hulutable` 行，禁用补丁会被跳过并打印 warning（无副作用），届时可从 patch 中移除该条。

## 社区建设（发布后）

- [ ] 提供清晰的 issue 模板与标签。
- [ ] 决定是否发布 npm（`pnpm publish`），并先在 `package.json` 补全 author/contributors。
- [ ] 预留 `CHANGELOG.md` 每版本维护（Keep a Changelog 风格）。
- [ ] 考虑挂 GitHub Release 并把 `releases/*.tgz` 作为附件发布。

## 已知限制（如实告知用户）

- 数据仅存浏览器 IndexedDB：清浏览器数据即清空表格；跨设备同步需自行用「备份/恢复」或 Excel 导出迁移。
- 插件是 DeepSeek Harness 技术预览期的 Web 客户端插件：SDK 包（`@deepseek-ai/*`）尚未发布 npm，运行由 Web 外壳提供平台模块；开发期类型检查/测试需 `pnpm link-sdk` 链接本地 harness checkout。
- `dsh.client.inject` 清单沿用内置插件同款服务键；若上游外壳调整服务接口，需跟随适配。
