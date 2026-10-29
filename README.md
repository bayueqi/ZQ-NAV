# 琪舟阁 - 精品网址导航站



<p align="center">
  一个优雅、快速、易于部署的书签（网址）收藏与分享平台，完全基于 Cloudflare 全家桶构建。
</p>



<p align="center">
  <strong>在线体验:</strong> <a href="https://nav.520jacky.dpdns.org">https://nav.520jacky.dpdns.org</a>
</p>

---


## ✨ 核心特性

- 📱 **响应式设计**：完美适配桌面、平板和手机等各种设备。
- 🎨 **主题美观**：界面简洁优雅，站点名称与副标题可在后台修改。
- 🔍 **快速搜索**：内置站内模糊搜索，迅速定位所需网站。
- 📂 **分类清晰**：支持多级分类树结构，浏览直观高效。
- 🔒 **安全后台**：账号密码存在 D1，登录后可在后台修改。
- 🧩 **零 SQL 部署**：表结构由 Worker 在首次访问时自动创建。
- ⚡ **性能卓越**：利用 Cloudflare 边缘计算，实现秒级加载。
- 📤 **数据管理**：支持书签数据的导入与导出，方便迁移。




## 🚀 快速部署

> **准备工作**: 你需要一个 Cloudflare 账号。

### 步骤 1: 创建 D1 数据库

1. 在 Cloudflare 控制台，进入 `Workers & Pages` -> `D1`。
2. 点击 `创建数据库`，数据库名称输入 `book`，然后创建。

表结构不需要手动创建。部署代码后首次访问，Worker 会自动建好 `sites`、`categories`、`category_orders`、`admin_sessions`、`settings` 五张表。

### 步骤 2: 创建并部署 Worker

1. 回到 `Workers & Pages`，点击 `创建应用程序` -> `创建 Worker`。
2. 为你的 Worker 指定一个名称（例如 `my-nav`），然后点击 `部署`。
3. 部署后，点击 `编辑代码`。将本项目 `_worker.js` 文件中的所有代码复制并粘贴到编辑器中，替换掉原有内容。
4. 点击 `部署` 保存代码。

### 步骤 3: 绑定 D1 数据库

1. 进入你刚刚创建的 Worker 的 `设置` -> `变量`。
2. 在 **D1 数据库绑定** 中，点击 `添加绑定`：
   - 变量名称: `NAV_DB`
   - D1 数据库: 选择你创建的 `book`

绑定后重新部署一次，让绑定生效。

### 步骤 4: 登录后台

1. 访问你的 Worker 域名（例如 `my-nav.your-subdomain.workers.dev`），页面会给出进入后台的入口。
2. 访问 `你的域名/admin`，使用默认账号 `admin`、密码 `admin` 登录。
3. 登录后点顶部「设置」修改管理员账号和密码，然后添加第一个书签，首页即可正常显示。

## ⚙️ 站点设置

登录后台后，顶部「设置」里可以修改以下内容，保存后立即生效：

| 设置项 | 说明 | 默认值 |
| --- | --- | --- |
| 站点名称 | 显示在首页标题、侧边栏和页脚 | `琪舟阁` |
| 副标题 | 显示在首页顶部 | `- 指路人，亦是摘星人。` |
| 图标 API | 图标地址模板，`{domain}` 会替换成站点域名 | `https://toolb.cn/favicon/{domain}` |
| 管理员账号 | 后台登录账号 | `admin` |
| 新密码 | 修改密码时填写，需要同时填写当前密码 | `admin` |
| 允许访客投稿 | 是否开放 `POST /api/config/submit` | 开启 |

这些值保存在 D1 的 `settings` 表里，不需要在 Worker 上配置环境变量。

**忘记后台密码时**：在 Worker 的 `设置` -> `变量` 里添加 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`（可加密），这组账号密码也能登录后台；进入后台后把密码改回来，再删掉这两个变量。

## 🛣️ 路由

| 路径 | 用途 |
| --- | --- |
| `/` | 前台导航页，支持 `?catalog=分类路径` 筛选 |
| `/admin` | 后台登录与管理界面 |
| `/api/config` | 书签的增删改查 |
| `/api/categories` | 分类的增删改查 |
| `/api/settings` | 站点设置的读取与保存，需要登录 |
| `/api/config/import`、`/api/config/export` | 书签的导入与导出，导出内容只有书签 |
| `/api/config/submit` | 访客投稿，受「允许访客投稿」开关控制 |

### 项目结构

- `_worker.js`: 包含所有后端逻辑、API 路由和前端页面渲染的入口文件。
- 主要逻辑模块:
  - `api`: 处理所有数据交互的 API 请求。
  - `admin`: 负责后台管理界面的渲染和逻辑。
  - `handleRequest`: 负责前台页面的渲染和路由。


## 🔧 技术栈

- **计算**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **数据库**: [Cloudflare D1](https://developers.cloudflare.com/d1/)（数据存储+会话管理+站点设置）
- **前端框架**: [TailwindCSS](https://tailwindcss.com/)

## 🌟 贡献

欢迎通过 Issue 或 Pull Request 为本项目贡献代码、提出问题或建议！

1. Fork 本仓库
2. 创建你的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交你的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到你的分支 (`git push origin feature/amazing-feature`)
5. 创建一个 Pull Request

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。
