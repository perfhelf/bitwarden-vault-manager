# 🔐 Bitwarden Vault Manager

一个功能强大的 Bitwarden 密码库管理面板，支持去重合并、健康分析、URL 失效检测、批量操作等高级功能。

🌐 **在线演示**: [bitwarden.xuebz.com](https://bitwarden.xuebz.com/)（点击「演示模式」免登录体验）

**所有加密解密均在浏览器本地完成，服务端仅做 API 代理转发，不接触任何明文数据。**

## ✨ 功能特性

### 📊 总览仪表板
- 密码库概览统计
- 重复项/弱密码/空密码一目了然

### 🔗 URL 失效检测
- **一次性全量扫描**：登录后自动检测所有条目的 URL 连通性
- **多策略探测**：fetch (no-cors) + `<img>` favicon 双策略，智能识别 Cloudflare 等 Bot 防护
- **大厂白名单**：内置 ~200 个主流域名（Google、Apple、Microsoft、Amazon、Meta、Netflix 等），自动跳过，支持父域名匹配
- **实时进度条**：渐变动画进度条 + 域名计数，检测过程可视
- **ID 去重**：同一条目绝不重复展示
- **批量处理**：支持全选、批量删除、批量移动

### 🔍 智能去重
- **完全重复检测**：URI + 用户名 + 密码三重匹配
- **同站重复检测**：相同站点不同凭据（支持 Android/iOS App URI 同站识别）
- **深度字段比较**：名称、TOTP、备注、自定义字段、通行密钥、收藏状态
- **ABC 三路合并策略**：
  - **Path A (纯删除)**：100% 完全一致 → 保留一个，删除其余
  - **Path B (新建合并)**：有差异且无通行密钥 → 取并集新建条目（URIs + 备注 + 自定义字段 + TOTP）→ 验证成功后删除所有原条目
  - **Path C (通行密钥合并)**：有差异且含通行密钥 → 将数据合并入通行密钥条目（通行密钥绑定加密密钥，无法迁移）→ 删除其余条目
- **智能标题选择**：中文优先，最短优先，淘汰标题保存到备注
- **URL 精简**：自动去除 `www.` 前缀和多余路径
- **安全保障**：全部软删除（30天可恢复），Path B 新建失败时原条目不删除

### 🏥 健康分析
- 弱密码检测
- 空密码检测（排除通行密钥条目）
- 密码重复使用检测
- 过期密码检测（>1年）
- 不安全 URI 检测（http://）

### 📝 条目管理
- 查看/编辑所有字段（含自定义字段解密）
- 批量移动文件夹
- 批量删除
- 文件夹创建/重命名/删除
- 高级搜索和过滤
- **按类型浏览**：支付卡 💳 / 身份 🪪 / 安全笔记 📝 / SSH 密钥 🔑 独立侧栏入口
- **已损坏条目**：自动识别解密失败的条目

### ⚡ 乐观热更新
- **即时 UI 反馈**：所有操作（删除、编辑、移动、文件夹管理）瞬间更新界面
- **后台静默同步**：服务端操作在后台异步执行
- **失败自动回滚**：服务端失败时 Toast 通知 + 自动 resync 恢复数据
- **永久删除例外**：不可逆操作保持悲观模式（先确认服务端成功再更新 UI）

### 🗑️ 回收站
- 恢复已删除条目到指定文件夹
- 永久删除
- 批量操作

### 🔒 安全特性
- 支持密码登录 + API Key 登录
- 支持 PBKDF2 + Argon2 密钥派生
- 全端加密/解密（浏览器本地执行）
- 会话持久化（sessionStorage）

## 🚀 快速开始

### 开发模式

```bash
npm install
npm run dev
```

### 部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/perfhelf/bitwarden-vault-manager)

项目使用 Vercel Rewrites 代理 Bitwarden 官方 API，无需配置任何环境变量。

## 🏗️ 技术架构

- **前端**：纯 HTML + CSS + JavaScript（无框架依赖）
- **构建**：Vite
- **加密**：Web Crypto API + argon2-browser
- **部署**：Vercel（静态站点 + Rewrites 代理）

### 项目结构

```
src/
├── app.js              # 主应用逻辑（含 URL 检测、乐观热更新）
├── bitwarden-api.js    # Bitwarden API 客户端
├── crypto.js           # 加密/解密引擎
├── dedup-engine.js     # 去重检测与合并引擎
├── health-engine.js    # 健康分析引擎
├── search-engine.js    # 搜索与过滤引擎
└── style.css           # 样式
```

## 📄 License

MIT License - 详见 [LICENSE](LICENSE) 文件
