# 🔐 Bitwarden Vault Manager

一个功能强大的 Bitwarden 密码库管理面板，支持去重合并、健康分析、批量操作等高级功能。

**所有加密解密均在浏览器本地完成，服务端仅做 API 代理转发，不接触任何明文数据。**

## ✨ 功能特性

### 📊 总览仪表板
- 密码库概览统计
- 重复项/弱密码/空密码一目了然

### 🔍 智能去重
- **完全重复检测**：URI + 用户名 + 密码三重匹配
- **同站重复检测**：相同站点不同凭据
- **深度字段比较**：名称、TOTP、备注、自定义字段、通行密钥、收藏状态
- **智能合并引擎**：
  - 自动合并通行密钥、URI、TOTP、自定义字段
  - 智能标题选择（中文优先，最短优先）
  - 被淘汰标题保存到备注
  - 软删除（30天可恢复）

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

### 🗑️ 回收站
- 恢复已删除条目
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
├── app.js              # 主应用逻辑
├── bitwarden-api.js    # Bitwarden API 客户端
├── crypto.js           # 加密/解密引擎
├── dedup-engine.js     # 去重检测与合并引擎
├── health-engine.js    # 健康分析引擎
├── search-engine.js    # 搜索与过滤引擎
└── style.css           # 样式
```

## 📄 License

MIT License - 详见 [LICENSE](LICENSE) 文件
