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
- 🎨 **主题美观**：界面简洁优雅，支持自定义主色调。
- 🔍 **快速搜索**：内置站内模糊搜索，迅速定位所需网站。
- 📂 **分类清晰**：支持多级分类树结构，浏览直观高效。
- 🔒 **安全后台**：基于环境变量的管理员认证+D1会话管理，提供完整的书签增删改查后台。
- ⚡ **性能卓越**：利用 Cloudflare 边缘计算，实现秒级加载。
- 📤 **数据管理**：支持书签数据的导入与导出，格式兼容，方便迁移。




## 🚀 快速部署

> **准备工作**: 你需要一个 Cloudflare 账号。

### 步骤 1: 创建 D1 数据库

1.  在 Cloudflare 控制台，进入 `Workers & Pages` -> `D1`。
2.  点击 `创建数据库`，数据库名称输入 `book`，然后创建。

3.  进入数据库的`控制台`，执行下方的 SQL 语句来快速创建所需的表结构。(注意移除中文注释)

```sql
-- 创建已发布网站表
CREATE TABLE IF NOT EXISTS sites (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
url TEXT NOT NULL,
logo TEXT,
"desc" TEXT,
catelog TEXT NOT NULL,
status TEXT,
sort_order INTEGER NOT NULL DEFAULT 9999,
create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建多级分类表（支持无限级子分类）
CREATE TABLE IF NOT EXISTS categories (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
parent_id INTEGER DEFAULT 0,
path TEXT NOT NULL UNIQUE,
sort_order INTEGER DEFAULT 0,
create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建管理员会话表（登录状态存储）
CREATE TABLE IF NOT EXISTS admin_sessions (
token TEXT PRIMARY KEY,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
expires_at DATETIME NOT NULL
);
```
> **提示**: 使用 SQL 是最快捷的方式。加了 `IF NOT EXISTS` 可以安全重复执行。部署代码后首次访问页面，`categories` 和 `admin_sessions` 表也会被自动创建，不手动执行SQL也可以。

### 步骤 2: 创建并部署 Worker

1.  回到 `Workers & Pages`，点击 `创建应用程序` -> `创建 Worker`。
2.  为你的 Worker 指定一个名称（例如 `my-nav`），然后点击 `部署`。

3.  部署后，点击 `编辑代码`。将本项目 `_worker.js` 文件中的所有代码复制并粘贴到编辑器中，替换掉原有内容。
4.  点击 `部署` 保存代码。

### 步骤 3: 绑定数据库与环境变量

1.  进入你刚刚创建的 Worker 的 `设置` -> `变量`。
2.  在 **D1 数据库绑定** 中，点击 `添加绑定`：
    -   变量名称: `NAV_DB`
    -   D1 数据库: 选择你创建的 `book`
3.  在 **环境变量** 中，点击 `添加变量`，添加以下配置：

    **必需配置：**
    -   变量名称: `ADMIN_USERNAME`，值: 你的管理员用户名（例如 `admin`），需要加密.
    -   变量名称: `ADMIN_PASSWORD`，值: 你的管理员密码，需要加密.

    **可选配置：**
    -   变量名称: `FaviconApi`，值: 自定义的图标API URL（例如 `https://toolb.cn/favicon/{domain}`），不加密.
    
    > **说明**: 如果不设置 `FaviconApi`，系统会默认使用 `https://toolb.cn/favicon/{domain}`
### 步骤 4: 开始使用

1.  访问你的 Worker 域名（例如 `my-nav.your-subdomain.workers.dev`）。首次访问会提示没有数据。
2.  访问 `你的域名/admin` 进入后台，使用你在 **步骤 3** 中设置的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
3.  在后台添加第一个书签后，首页即可正常显示。


### 项目结构

-   `_worker.js`: 包含所有后端逻辑、API 路由和前端页面渲染的入口文件。
-   主要逻辑模块:
    -   `api`: 处理所有数据交互的 API 请求。
    -   `admin`: 负责后台管理界面的渲染和逻辑。
    -   `handleRequest`: 负责前台页面的渲染和路由。


## 🔧 技术栈

-   **计算**: [Cloudflare Workers](https://workers.cloudflare.com/)
-   **数据库**: [Cloudflare D1](https://developers.cloudflare.com/d1/)（数据存储+会话管理）
-   **前端框架**: [TailwindCSS](https://tailwindcss.com/)

## 🌟 贡献

欢迎通过 Issue 或 Pull Request 为本项目贡献代码、提出问题或建议！

1.  Fork 本仓库
2.  创建你的功能分支 (`git checkout -b feature/amazing-feature`)
3.  提交你的更改 (`git commit -m 'Add some amazing feature'`)
4.  推送到你的分支 (`git push origin feature/amazing-feature`)
5.  创建一个 Pull Request

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。
