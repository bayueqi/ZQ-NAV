const SETTINGS_DEFAULTS = {
  admin_user: 'admin',
  admin_pass: 'admin',
  favicon_api: '',
  site_title: '琪舟阁',
  site_subtitle: '——— 指路人，亦是摘星人',
};

async function readSettings(env) {
  const out = Object.assign({}, SETTINGS_DEFAULTS);
  let hasPass = false;
  try {
    const { results } = await env.NAV_DB.prepare('SELECT key, value FROM settings').all();
    for (const row of results || []) {
      if (!row || !row.key) continue;
      out[row.key] = row.value === null || row.value === undefined ? '' : String(row.value);
      if (row.key === 'admin_pass') hasPass = true;
    }
  } catch (error) {
    // 表还没建或没绑 D1，用默认值
  }
  // 老部署已经配了环境变量：没在后台设过密码时按环境变量初始化，避免默认 admin/admin 成为后门
  if (!hasPass && env.ADMIN_PASSWORD) {
    out.admin_pass = String(env.ADMIN_PASSWORD);
    if (env.ADMIN_USERNAME) out.admin_user = String(env.ADMIN_USERNAME);
  }
  return out;
}

async function writeSettings(env, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return;
  const stmts = keys.map((key) => env.NAV_DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, patch[key] === null || patch[key] === undefined ? '' : String(patch[key])));
  await env.NAV_DB.batch(stmts);
}

/**
 * 获取图标 API URL（设置已就绪时同步取值）
*/
function getIconApiUrl(env, settings) {
  const s = settings || {};
  return s.favicon_api || (env && env.FaviconApi) || 'https://toolb.cn/favicon/{domain}';
}

/**
 * 渲染单个网站卡片（优化版）
 */

// 给指定 id 的 input 写入 value，用于后台表单回填
function fillInputValue(html, id, value) {
  const pattern = new RegExp('(<input[^>]*\\bid="' + id + '"[^>]*?)(\\s*/?>)');
  return html.replace(pattern, (match, head, tail) => {
    const cleaned = head.replace(/\s+value="[^"]*"/, '');
    return cleaned + ' value="' + escapeHTML(value) + '"' + tail;
  });
}

// 静态资源 ETag：内容不变时返回 304，省掉重复传输
// Worker 实例内文件内容固定，每个文件只算一次哈希
const STATIC_ETAGS = new Map();
function staticEtag(filePath, text) {
  let etag = STATIC_ETAGS.get(filePath);
  if (!etag) {
    etag = '"' + contentHash(text) + '"';
    STATIC_ETAGS.set(filePath, etag);
  }
  return etag;
}
function contentHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + '-' + text.length.toString(36);
}

// 单一正则做一遍替换，比连续五次 replace 少扫四遍字符串
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHTML(input) {
  if (input === null || input === undefined) {
    return '';
  }
  return String(input).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function sanitizeUrl(url) {
  if (!url) {
    return '';
  }
  const trimmed = String(url).trim();
  try {
    const direct = new URL(trimmed);
    if (direct.protocol === 'http:' || direct.protocol === 'https:') {
      return direct.href;
    }
  } catch (error) {
    try {
      const fallback = new URL(`https://${trimmed}`);
      if (fallback.protocol === 'http:' || fallback.protocol === 'https:') {
        return fallback.href;
      }
    } catch (e) {
      return '';
    }
  }
  return '';
}

// 统一的 JSON 响应
function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders)
  });
}

// LIKE 查询前转义通配符，避免分类名或关键词里的 % _ 被当成通配
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => '\\' + ch);
}

function normalizeSortOrder(value) {
  if (value === undefined || value === null || value === '') {
    return 9999;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    const clamped = Math.max(-2147483648, Math.min(2147483647, Math.round(parsed)));
    return clamped;
  }
  return 9999;
}

// ========== 多级分类系统 ==========
// 未选择/未填写分类时的兜底分类名
const DEFAULT_CATALOG = '默认';
// 建表与迁移在实例生命周期内只执行一次，之后所有请求直接跳过
let SCHEMA_READY = false;
let SCHEMA_TASK = null;

async function ensureCategoriesTable(env) {
  if (SCHEMA_READY) return;
  if (!SCHEMA_TASK) {
    SCHEMA_TASK = runSchemaSetup(env).then(() => {
      SCHEMA_READY = true;
    }).catch((e) => {
      console.error('ensureCategoriesTable error:', e);
      SCHEMA_TASK = null;
    });
  }
  return SCHEMA_TASK;
}

async function runSchemaSetup(env) {
  const db = env.NAV_DB;
  // 建表 + 索引合并成一次批量往返
  const statements = [
    `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT 0,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    // 创建管理员会话表（替代KV存储）
    `CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )`,
    // 书签表：旧版本要手动执行 SQL，现在首次访问自动建
    `CREATE TABLE IF NOT EXISTS sites (
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
      )`,
    `CREATE TABLE IF NOT EXISTS category_orders (
        catelog TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
    // 站点配置：账号密码、图标 API、站点名称都在这里，后台可改
    `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`
  ];
  try {
    await db.batch(statements.map((sql) => db.prepare(sql)));
  } catch (e) {
    console.error('Failed to create tables:', e);
  }
  // 索引单独一批，旧库结构异常时不影响上面的建表
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_sites_catelog ON sites(catelog)',
    'CREATE INDEX IF NOT EXISTS idx_sites_order ON sites(sort_order, create_time)',
    'CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at)'
  ];
  for (const sql of indexStatements) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      // 索引建不上不影响读写，忽略
    }
  }
  // 清理过期会话
  try {
    await db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  } catch (e) {
    // 表可能还不存在，忽略
  }
  // 迁移现有分类：从 sites 表的 catelog 字段提取（仅首次）
  try {
    const catCount = await db.prepare('SELECT COUNT(*) as cnt FROM categories').first();
    if (catCount && Number(catCount.cnt) === 0) {
      const { results: catelogs } = await db.prepare(
        'SELECT DISTINCT catelog FROM sites WHERE catelog IS NOT NULL AND catelog != \'\' '
      ).all();
      for (const row of catelogs || []) {
        const name = (row.catelog || '').trim();
        if (!name) continue;
        // 如果包含分隔符，按路径迁移
        const parts = name.split('/');
        let currentParentId = 0;
        let currentPath = '';
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim();
          if (!part) continue;
          currentPath = currentPath ? currentPath + '/' + part : part;
          const existing = await db.prepare('SELECT id FROM categories WHERE path = ?').bind(currentPath).first();
          if (existing) {
            currentParentId = existing.id;
          } else {
            const result = await db.prepare(
              'INSERT INTO categories (name, parent_id, path, sort_order) VALUES (?, ?, ?, 0)'
            ).bind(part, currentParentId, currentPath).run();
            currentParentId = result.meta.last_row_id;
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to migrate categories:', e);
  }
}

function buildCategoryTree(categories, parentId = 0) {
  const result = [];
  const children = categories.filter(c => c.parent_id === parentId);
  children.sort((a, b) => {
    const sortDiff = (a.sort_order || 0) - (b.sort_order || 0);
    if (sortDiff !== 0) return sortDiff;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });
  for (const cat of children) {
    const node = {
      id: cat.id,
      name: cat.name,
      parent_id: cat.parent_id,
      path: cat.path,
      sort_order: cat.sort_order,
      site_count: cat.site_count || 0,
      level: cat.path ? cat.path.split('/').length - 1 : 0,
      children: buildCategoryTree(categories, cat.id)
    };
    result.push(node);
  }
  return result;
}

function flattenCategoryTree(tree, result = []) {
  for (const node of tree) {
    result.push(node);
    if (node.children && node.children.length > 0) {
      flattenCategoryTree(node.children, result);
    }
  }
  return result;
}

// 递归剪枝：过滤掉自身无书且所有子分类也无书的空分类节点
function pruneEmptyCategories(tree) {
  const result = [];
  for (const node of tree) {
    const prunedChildren = node.children ? pruneEmptyCategories(node.children) : [];
    const hasSites = (node.site_count || 0) > 0;
    const hasChildrenWithSites = prunedChildren.length > 0;
    if (hasSites || hasChildrenWithSites) {
      result.push({
        ...node,
        children: prunedChildren
      });
    }
  }
  return result;
}

// 递归汇总子分类的书签数到父分类（后序遍历）
// 调用后每个节点的 site_count = 自身直接书签数 + 所有后代分类的书签数
function rollupCategoryCounts(nodes) {
  let total = 0;
  for (const node of nodes) {
    let subtree = node.site_count || 0;
    if (node.children && node.children.length > 0) {
      subtree += rollupCategoryCounts(node.children);
    }
    node.site_count = subtree;
    total += subtree;
  }
  return total;
}

// 清理数据库中没有书签且没有子分类的孤儿分类节点
async function cleanupOrphanCategories(env) {
  try {
    // 删除没有书签且没有子分类的分类（由下往上，最多 8 层，防止异常数据导致死循环）
    let deleted = 0;
    for (let round = 0; round < 8; round++) {
      const { results: orphans } = await env.NAV_DB.prepare(`
        SELECT c.id FROM categories c
        LEFT JOIN sites s ON s.catelog = c.path
        LEFT JOIN categories child ON child.parent_id = c.id
        WHERE s.id IS NULL AND child.id IS NULL
      `).all();
      if (!orphans || orphans.length === 0) break;
      await env.NAV_DB.batch(orphans.map((orphan) => (
        env.NAV_DB.prepare('DELETE FROM categories WHERE id = ?').bind(orphan.id)
      )));
      deleted += orphans.length;
    }
    return deleted;
  } catch (e) {
    console.error('cleanupOrphanCategories error:', e);
    return 0;
  }
}

// 同步分类路径：确保路径中每一级分类都存在于 categories 表中
// 当某父级第一次获得子分类时，把原先直挂该父级的书签自动迁到 父级/默认
async function syncCategoryPath(env, catelogPath) {
  if (!catelogPath) return;
  const path = (catelogPath || '').trim();
  if (!path) return;
  const parts = path.split('/').map(p => p.trim()).filter(p => p);
  if (parts.length === 0) return;

  // 分类总量很小，一次取回全部路径，避免逐级查询往返
  const byPath = new Map();
  try {
    const { results } = await env.NAV_DB.prepare('SELECT id, path FROM categories').all();
    for (const row of results || []) byPath.set(row.path, row);
  } catch (e) {
    // 表不存在时按空处理，后面的插入会失败并被调用方捕获
  }

  let currentParentId = 0;
  let currentPath = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const parentPath = currentPath; // 加上本段前的路径 = 父级路径
    currentPath = currentPath ? currentPath + '/' + part : part;
    const existing = byPath.get(currentPath);
    if (existing) {
      currentParentId = existing.id;
      continue;
    }
    // 即将为父级（路径 parentPath）创建子分类；若是父级的第一个子分类，迁移父级直挂书签到 父级/默认
    if (i > 0 && parentPath) {
      await migrateDirectBookmarksToDefault(env, parentPath, currentParentId, part);
    }
    // 获取同级最大sort_order + 1（migrate 可能刚插入"默认"节点，这里必须实时取）
    const maxSort = await env.NAV_DB.prepare(
      'SELECT MAX(sort_order) as max_sort FROM categories WHERE parent_id = ?'
    ).bind(currentParentId).first();
    const sortOrder = (maxSort && maxSort.max_sort !== null) ? maxSort.max_sort + 1 : 0;
    const result = await env.NAV_DB.prepare(
      'INSERT INTO categories (name, parent_id, path, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(part, currentParentId, currentPath, sortOrder).run();
    currentParentId = result.meta.last_row_id;
    byPath.set(currentPath, { id: currentParentId, path: currentPath });
  }
}

// 父级首次出现子分类时，把直挂父级（catelog === parentPath）的书签迁移到 父级/默认
async function migrateDirectBookmarksToDefault(env, parentPath, parentId, creatingPart) {
  // 仅当父级目前没有任何子分类时触发（这是第一个子分类）
  const cc = await env.NAV_DB.prepare('SELECT COUNT(*) as cnt FROM categories WHERE parent_id = ?').bind(parentId).first();
  if (!cc || cc.cnt > 0) return;
  // 父级是否有直挂书签
  const direct = await env.NAV_DB.prepare('SELECT id FROM sites WHERE catelog = ? LIMIT 1').bind(parentPath).first();
  if (!direct) return;
  const defaultPath = parentPath + '/默认';
  // 确保"默认"子分类节点存在；若正在创建的就是"默认"则由调用方插入，此处跳过
  if (creatingPart !== '默认') {
    const exist = await env.NAV_DB.prepare('SELECT id FROM categories WHERE path = ?').bind(defaultPath).first();
    if (!exist) {
      const ms = await env.NAV_DB.prepare('SELECT MAX(sort_order) as m FROM categories WHERE parent_id = ?').bind(parentId).first();
      const so = (ms && ms.m !== null) ? ms.m + 1 : 0;
      await env.NAV_DB.prepare('INSERT INTO categories (name, parent_id, path, sort_order) VALUES (?, ?, ?, ?)').bind('默认', parentId, defaultPath, so).run();
    }
  }
  // 迁移直挂书签到 父级/默认
  await env.NAV_DB.prepare('UPDATE sites SET catelog = ? WHERE catelog = ?').bind(defaultPath, parentPath).run();
}

const SESSION_COOKIE_NAME = 'nav_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12小时会话

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) {
        acc[pair] = '';
      } else {
        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        acc[key] = value;
      }
      return acc;
    }, {});
}

function buildSessionCookie(token, options = {}) {
  const { maxAge = SESSION_TTL_SECONDS } = options;
  const segments = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
  ];
  return segments.join('; ');
}

async function createAdminSession(env) {
  const token = crypto.randomUUID();
  // 使用SQLite的datetime函数计算过期时间，格式与datetime('now')一致
  const hours = Math.round(SESSION_TTL_SECONDS / 3600);
  await env.NAV_DB.prepare(
    `INSERT INTO admin_sessions (token, expires_at) VALUES (?, datetime('now', '+${hours} hours'))`
  ).bind(token).run();
  return token;
}

async function refreshAdminSession(env, token) {
  const hours = Math.round(SESSION_TTL_SECONDS / 3600);
  await env.NAV_DB.prepare(
    `UPDATE admin_sessions SET expires_at = datetime('now', '+${hours} hours') WHERE token = ?`
  ).bind(token).run();
}

async function destroyAdminSession(env, token) {
  if (!token) return;
  await env.NAV_DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
}

async function validateAdminSession(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return { authenticated: false };
  }
  try {
    // 顺带取出剩余秒数：只有过期过半才续期，避免每个请求都写一次 D1
    const session = await env.NAV_DB.prepare(
      `SELECT token, (julianday(expires_at) - julianday('now')) * 86400 AS remain
       FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')`
    ).bind(token).first();
    if (!session) {
      return { authenticated: false };
    }
    if (!(session.remain > SESSION_TTL_SECONDS / 2)) {
      try {
        await refreshAdminSession(env, token);
      } catch (e) {
        // 续期失败不影响本次请求的鉴权结果
      }
    }
    return { authenticated: true, token };
  } catch (e) {
    return { authenticated: false };
  }
}

async function isAdminAuthenticated(request, env) {
  const { authenticated } = await validateAdminSession(request, env);
  return authenticated;
}

  
  /**
   * 处理 API 请求
   */
  const api = {
    async handleRequest(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname.replace('/api', ''); // 去掉 "/api" 前缀
        const method = request.method;
        const id = url.pathname.split('/').pop(); // 获取最后一个路径段，作为 id (例如 /api/config/1)
        try {
            if (path === '/settings') {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                if (method === 'GET') return await this.getSettings(request, env, ctx);
                if (method === 'POST') return await this.updateSettings(request, env, ctx);
                return this.errorResponse('Method Not Allowed', 405);
            }
            if (path === '/config') {
                switch (method) {
                    case 'GET':
                        if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                        return await this.getConfig(request, env, ctx, url);
                    case 'POST':
                        if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                        return await this.createConfig(request, env, ctx);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
           if (path === '/categories') {
              if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
              if (method === 'GET') {
                  return await this.getCategories(request, env, ctx);
              }
              if (method === 'POST') {
                  return await this.createCategory(request, env, ctx);
              }
              return this.errorResponse('Method Not Allowed', 405);
           }
            if (path.startsWith('/categories/')) {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                const catIdOrName = decodeURIComponent(path.replace('/categories/', ''));
                // 处理 /categories/:id/move
                const moveMatch = catIdOrName.match(/^(\d+)\/move$/);
                if (moveMatch && method === 'POST') {
                    return await this.moveCategory(request, env, ctx, parseInt(moveMatch[1]));
                }
                // 数字ID：更新或删除分类
                if (/^\d+$/.test(catIdOrName)) {
                    switch (method) {
                        case 'PUT':
                            return await this.updateCategory(request, env, ctx, parseInt(catIdOrName));
                        case 'DELETE':
                            return await this.deleteCategory(request, env, ctx, parseInt(catIdOrName));
                        default:
                            return this.errorResponse('Method Not Allowed', 405);
                    }
                }
                // 旧的分类名排序接口（保留兼容）
                switch (method) {
                    case 'PUT':
                        return await this.updateCategoryOrder(request, env, ctx, catIdOrName);
                    default:
                        return this.errorResponse('Method Not Allowed', 405);
                }
            }
            if (path === `/config/${id}` && /^\d+$/.test(id)) {
                switch (method) {
                    case 'PUT':
                        if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                        return await this.updateConfig(request, env, ctx, id);
                    case 'DELETE':
                        if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                        return await this.deleteConfig(request, env, ctx, id);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
              if (path === '/config/batch' && method === 'POST') {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                return await this.batchConfig(request, env, ctx);
            }
            if (path === '/config/ids' && method === 'GET') {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                return await this.getConfigIds(request, env, url);
            }
            if (path === '/config/import' && method === 'POST') {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                return await this.importConfig(request, env, ctx);
            }
            if (path === '/config/export' && method === 'GET') {
                if (!(await isAdminAuthenticated(request, env))) return this.errorResponse('Unauthorized', 401);
                return await this.exportConfig(request, env, ctx);
            }
            if (path === '/logout' && method === 'POST') {
              return await this.logout(request, env, ctx);
            }
            return this.errorResponse('Not Found', 404);
        } catch (error) {
            return this.errorResponse(`Internal Server Error: ${error.message}`, 500);
        }
    },
      async getConfig(request, env, ctx, url) {
              try {
                  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
                  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10) || 10));
                  const offset = (page - 1) * pageSize;
                  const catalog = (url.searchParams.get('catalog') || '').trim();
                  const keyword = (url.searchParams.get('keyword') || '').trim();

                  const conditions = [];
                  const params = [];
                  if (catalog) {
                      // 包含该分类及其所有子分类
                      conditions.push(`(catelog = ? OR catelog LIKE ? ESCAPE '\\')`);
                      params.push(catalog, escapeLike(catalog) + '/%');
                  }
                  if (keyword) {
                      const like = '%' + escapeLike(keyword) + '%';
                      conditions.push(`(name LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR catelog LIKE ? ESCAPE '\\' OR "desc" LIKE ? ESCAPE '\\')`);
                      params.push(like, like, like, like);
                  }
                  const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

                  const [listRes, countResult] = await Promise.all([
                      env.NAV_DB.prepare(`SELECT * FROM sites${whereSql} ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`)
                          .bind(...params, pageSize, offset).all(),
                      env.NAV_DB.prepare(`SELECT COUNT(*) as total FROM sites${whereSql}`)
                          .bind(...params).first()
                  ]);

                  return json({
                      code: 200,
                      data: (listRes && listRes.results) || [],
                      total: countResult ? countResult.total : 0,
                      page,
                      pageSize
                  });
              } catch (e) {
                  return this.errorResponse(`Failed to fetch config data: ${e.message}`, 500)
              }
          },
      // 批量操作：批量迁移分类 / 批量删除
      async batchConfig(request, env, ctx) {
        try {
          const body = await request.json().catch(() => ({}));
          const action = String(body.action || '');
          const ids = Array.from(new Set(
            (Array.isArray(body.ids) ? body.ids : [])
              .map(v => parseInt(v, 10))
              .filter(v => Number.isInteger(v) && v > 0)
          ));
          if (ids.length === 0) return this.errorResponse('未选择任何书签', 400);
          if (ids.length > 1000) return this.errorResponse('单次最多处理 1000 条', 400);
          if (action !== 'move' && action !== 'delete' && action !== 'reorder') return this.errorResponse('不支持的操作', 400);

          const CHUNK = 50;
          let affected = 0;
          if (action === 'reorder') {
            // 以选中项中最靠前的一项为起点，选中项连续排列，其余书签顺延；
            // 全部重新编号为 1..N，避免出现重复或空洞。
            const { results } = await env.NAV_DB.prepare(
              'SELECT id, sort_order FROM sites ORDER BY sort_order ASC, create_time DESC, id ASC'
            ).all();
            const list = results || [];
            if (!list.length) return this.errorResponse('没有可排序的书签', 400);
            const idSet = new Set(ids);
            const picked = list.filter(row => idSet.has(row.id));
            if (!picked.length) return this.errorResponse('所选书签不存在', 400);
            const anchorId = picked[0].id;
            const anchorIndex = list.findIndex(row => row.id === anchorId);
            const nextOrder = list.slice(0, anchorIndex).concat(picked);
            for (let i = anchorIndex; i < list.length; i += 1) {
              if (!idSet.has(list[i].id)) nextOrder.push(list[i]);
            }
            const updates = [];
            nextOrder.forEach((row, index) => {
              const target = index + 1;
              if (row.sort_order !== target) {
                updates.push(env.NAV_DB.prepare('UPDATE sites SET sort_order = ? WHERE id = ?').bind(target, row.id));
              }
            });
            for (let i = 0; i < updates.length; i += CHUNK) {
              await env.NAV_DB.batch(updates.slice(i, i + CHUNK));
            }
            affected = picked.length;
          } else if (action === 'move') {
            const target = String(body.catelog || '').trim();
            if (!target) return this.errorResponse('请选择目标分类', 400);
            await syncCategoryPath(env, target);
            for (let i = 0; i < ids.length; i += CHUNK) {
              const chunk = ids.slice(i, i + CHUNK);
              const marks = chunk.map(() => '?').join(',');
              const res = await env.NAV_DB.prepare(
                `UPDATE sites SET catelog = ?, update_time = CURRENT_TIMESTAMP WHERE id IN (${marks})`
              ).bind(target, ...chunk).run();
              affected += (res && res.meta && typeof res.meta.changes === 'number') ? res.meta.changes : 0;
            }
          } else {
            for (let i = 0; i < ids.length; i += CHUNK) {
              const chunk = ids.slice(i, i + CHUNK);
              const marks = chunk.map(() => '?').join(',');
              const res = await env.NAV_DB.prepare(
                `DELETE FROM sites WHERE id IN (${marks})`
              ).bind(...chunk).run();
              affected += (res && res.meta && typeof res.meta.changes === 'number') ? res.meta.changes : 0;
            }
            try { await cleanupOrphanCategories(env); } catch (e) {}
          }
          return new Response(JSON.stringify({
            code: 200,
            message: action === 'move' ? '已迁移' : (action === 'reorder' ? '已重新排序' : '已删除'),
            data: { affected }
          }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return this.errorResponse(`批量操作失败: ${e.message}`, 500);
        }
      },
      // 按当前筛选条件返回全部书签 id，供"选择全部"使用
      async getConfigIds(request, env, url) {
        try {
          const catalog = (url.searchParams.get('catalog') || '').trim();
          const keyword = (url.searchParams.get('keyword') || '').trim();
          const where = [];
          const params = [];
          if (catalog) {
            where.push('(catelog = ? OR catelog LIKE ?)');
            params.push(catalog, catalog + '/%');
          }
          if (keyword) {
            const like = `%${keyword}%`;
            where.push('(name LIKE ? OR url LIKE ? OR catelog LIKE ? OR desc LIKE ?)');
            params.push(like, like, like, like);
          }
          let sql = 'SELECT id FROM sites';
          if (where.length) sql += ' WHERE ' + where.join(' AND ');
          sql += ' ORDER BY sort_order ASC, create_time DESC';
          const { results } = await env.NAV_DB.prepare(sql).bind(...params).all();
          const ids = (results || []).map(r => r.id);
          return new Response(JSON.stringify({ code: 200, data: ids, total: ids.length }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return this.errorResponse(`读取书签列表失败: ${e.message}`, 500);
        }
      },
      
      
    async createConfig(request, env, ctx) {
          try{
              const config = await request.json();
              const { name, url, logo, desc, catelog, sort_order } = config;
              const sanitizedName = (name || '').trim();
              const sanitizedUrl = (url || '').trim();
              const sanitizedCatelog = (catelog || '').trim() || DEFAULT_CATALOG;
              const sanitizedLogo = (logo || '').trim() || null;
              const sanitizedDesc = (desc || '').trim() || null;

              if (!sanitizedName || !sanitizedUrl) {
                  return this.errorResponse('Name and URL are required', 400);
              }
              
              let targetSortOrder = 1;
              if (!sort_order || sort_order === '') {
                  const maxSortResult = await env.NAV_DB.prepare('SELECT MAX(sort_order) as max_sort FROM sites WHERE sort_order != 9999').first();
                  targetSortOrder = (maxSortResult && maxSortResult.max_sort ? maxSortResult.max_sort + 1 : 1);
              } else {
                  targetSortOrder = parseInt(sort_order) || 1;
              }
              
              const [_, insert] = await env.NAV_DB.batch([
                  env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order != 9999').bind(targetSortOrder),
                  env.NAV_DB.prepare(`
                    INSERT INTO sites (name, url, logo, desc, catelog, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, sanitizedCatelog, targetSortOrder)
              ]);

              // 自动同步分类路径（新建不存在的分类节点）
              await syncCategoryPath(env, sanitizedCatelog);

            return json({
              code: 201,
              message: 'Config created successfully',
              insert
            }, 201)
          } catch(e) {
              return this.errorResponse(`Failed to create config : ${e.message}`, 500);
          }
      },
  
  
		async updateConfig(request, env, ctx, id) {
          try {
              const config = await request.json();
              const { name, url, logo, desc, catelog, sort_order } = config;
              const sanitizedName = (name || '').trim();
              const sanitizedUrl = (url || '').trim();
              const sanitizedCatelog = (catelog || '').trim() || DEFAULT_CATALOG;
              const sanitizedLogo = (logo || '').trim() || null;
              const sanitizedDesc = (desc || '').trim() || null;

            if (!sanitizedName || !sanitizedUrl) {
                return this.errorResponse('Name and URL are required', 400);
            }
            
            let targetSortOrder = 9999;
            if (sort_order && sort_order !== '') {
                const inputSortOrder = parseInt(sort_order);
                if (!isNaN(inputSortOrder)) {
                    targetSortOrder = inputSortOrder;
                }
            }
            
            const currentResult = await env.NAV_DB.prepare('SELECT sort_order FROM sites WHERE id = ?').bind(id).first();
            const currentSortOrder = currentResult ? currentResult.sort_order : 9999;
            
            if (targetSortOrder !== currentSortOrder && targetSortOrder !== 9999) {
                if (targetSortOrder < currentSortOrder) {
                    await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order < ? AND id != ? AND sort_order != 9999').bind(targetSortOrder, currentSortOrder, id).run();
                } else {
                    await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order <= ? AND id != ? AND sort_order != 9999').bind(currentSortOrder, targetSortOrder, id).run();
                }
            }

            const update = await env.NAV_DB.prepare(`
                UPDATE sites
                SET name = ?, url = ?, logo = ?, desc = ?, catelog = ?, sort_order = ?, update_time = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, sanitizedCatelog, targetSortOrder, id).run();

            // 自动同步分类路径（新建不存在的分类节点）
            await syncCategoryPath(env, sanitizedCatelog);
            // 清理可能变空的旧分类
            await cleanupOrphanCategories(env);

            return json({
                code: 200,
                message: 'Config updated successfully',
                update
            });
          } catch (e) {
              return this.errorResponse(`Failed to update config: ${e.message}`, 500);
          }
      },
  
      async deleteConfig(request, env, ctx, id) {
          try{
              const currentResult = await env.NAV_DB.prepare('SELECT sort_order FROM sites WHERE id = ?').bind(id).first();
              if (!currentResult) {
                  return this.errorResponse('Config not found', 404);
              }
              const deletedSortOrder = currentResult.sort_order;
              
              const batchStatements = [env.NAV_DB.prepare('DELETE FROM sites WHERE id = ?').bind(id)];
              if (deletedSortOrder !== 9999) {
                  batchStatements.push(env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order != 9999').bind(deletedSortOrder));
              }
              const [del] = await env.NAV_DB.batch(batchStatements);

              // 清理可能产生的空分类
              await cleanupOrphanCategories(env);
              
              return json({
                  code: 200,
                  message: 'Config deleted successfully',
                  del
              });
          } catch(e) {
            return this.errorResponse(`Failed to delete config: ${e.message}`, 500);
          }
      },
      async importConfig(request, env, ctx) {
        try {
          const jsonData = await request.json();
          let sitesToImport = [];

          if (Array.isArray(jsonData)) {
            sitesToImport = jsonData;
          } else if (jsonData && typeof jsonData === 'object' && Array.isArray(jsonData.data)) {
            sitesToImport = jsonData.data;
          } else {
            return this.errorResponse('Invalid JSON data. Must be an array of site configurations, or an object with a "data" key containing array.', 400);
          }
          
          if (sitesToImport.length === 0) {
            return json({
              code: 200,
              message: 'Import successful, but no data was found in file.'
            });
          }

          // 文件里可能自带重复 url：同一个 url 只保留最后出现的那条（后面的覆盖前面的）
          // 没有 url 的记录无法入库（url 是 NOT NULL），直接跳过
          const lastUrlAt = new Map();
          sitesToImport.forEach((item, i) => {
              const u = (item.url || '').trim();
              if (u) lastUrlAt.set(u, i);
          });
          const rows = sitesToImport.filter((item, i) => {
              const u = (item.url || '').trim();
              if (!u) return false;
              return lastUrlAt.get(u) === i;
          });
          if (rows.length === 0) {
              return json({ code: 200, message: '文件中没有可导入的记录（缺少 url）。' });
          }

          const urls = rows.map(item => (item.url || '').trim()).filter(url => url);
          if (urls.length > 0) {
              const placeholders = urls.map(() => '?').join(',');
              await env.NAV_DB.prepare(`DELETE FROM sites WHERE url IN (${placeholders})`).bind(...urls).run();
          }

          // 库里剩下没被本次覆盖的记录，它们的排序值优先保留，导入的往后让
          const { results: usedRows } = await env.NAV_DB.prepare(
              'SELECT sort_order FROM sites WHERE sort_order != 9999'
          ).all();
          const usedSort = new Set((usedRows || []).map(r => r.sort_order));

          // 按 sort_order 稳定排序（值相同的保持文件里的先后），再从 1 开始连续编号
          const ordered = rows
              .map((r, i) => ({ r, i }))
              .sort((a, b) => (normalizeSortOrder(a.r.sort_order) - normalizeSortOrder(b.r.sort_order)) || (a.i - b.i))
              .map(x => x.r);

          let nextSort = 1;
          const insertStatements = ordered.map(item => {
                const sanitizedUrl = (item.url || '').trim();
                // name / catelog 都是 NOT NULL，缺省时按 url 与默认分类兜底，避免整批导入失败
                const sanitizedName = (item.name || '').trim() || sanitizedUrl;
                const sanitizedLogo = (item.logo || '').trim() || null;
                const sanitizedDesc = (item.desc || '').trim() || null;
                const sanitizedCatelog = (item.catelog || '').trim() || DEFAULT_CATALOG;
                while (usedSort.has(nextSort)) nextSort += 1;
                const sortOrderValue = nextSort++;
                return env.NAV_DB.prepare(`
                        INSERT INTO sites (name, url, logo, desc, catelog, sort_order)
                        VALUES (?, ?, ?, ?, ?, ?)
                  `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, sanitizedCatelog, sortOrderValue);
            })
  
          await env.NAV_DB.batch(insertStatements);

          // 批量同步分类路径
          const catelogSet = new Set();
          for (const item of sitesToImport) {
            const cat = (item.catelog || '').trim();
            if (cat) catelogSet.add(cat);
          }
          for (const cat of catelogSet) {
            await syncCategoryPath(env, cat);
          }
          // 导入可能清空某些旧分类，清理孤儿
          await cleanupOrphanCategories(env);

          return json({
              code: 201,
              message: `Config imported successfully. ${rows.length} items processed.`
          }, 201);
        } catch (error) {
          return this.errorResponse(`Failed to import config : ${error.message}`, 500);
        }
      },
  
async exportConfig(request, env, ctx) {
        try{
          const url = new URL(request.url);
          const rawIds = (url.searchParams.get('ids') || '').trim();
          // 只导出业务字段：id、create_time、update_time 由数据库自己维护，导入时会重新生成
          const EXPORT_FIELDS = 'name, url, logo, desc, catelog, sort_order';
          let results = [];
          let filename = 'config.json';
          if (rawIds) {
            const ids = Array.from(new Set(rawIds.split(',').map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)));
            if (ids.length === 0) return this.errorResponse('未选择任何书签', 400);
            const marks = ids.map(() => '?').join(',');
            const res = await env.NAV_DB.prepare(
              `SELECT ${EXPORT_FIELDS} FROM sites WHERE id IN (${marks}) ORDER BY sort_order ASC, create_time DESC`
            ).bind(...ids).all();
            results = res.results || [];
            filename = 'config-selected.json';
          } else {
            const res = await env.NAV_DB.prepare(
              `SELECT ${EXPORT_FIELDS} FROM sites ORDER BY sort_order ASC, create_time DESC`
            ).all();
            results = res.results || [];
          }
          const pureJsonData = JSON.stringify(results, null, 2); 

          return new Response(pureJsonData, {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`
              }
          });
        } catch(e) {
          return this.errorResponse(`Failed to export config: ${e.message}`, 500)
        }
      },
      async getCategories(request, env, ctx) {
          try {
              // 注意：孤儿分类的清理在写操作（增删改/导入/审核）中已统一进行，读取时不再重复清理
              // 获取所有分类
              const { results: categories } = await env.NAV_DB.prepare(
                'SELECT id, name, parent_id, path, sort_order FROM categories ORDER BY sort_order ASC, id ASC'
              ).all();

              // 获取每个分类下直接的书签数量（后续会递归汇总子分类数量）
              const siteCountMap = new Map();
              try {
                  const { results: siteCounts } = await env.NAV_DB.prepare(`
                    SELECT catelog, COUNT(*) AS cnt FROM sites
                    WHERE catelog IS NOT NULL AND catelog != ''
                    GROUP BY catelog
                  `).all();
                  for (const row of siteCounts) {
                      siteCountMap.set(row.catelog, row.cnt);
                  }
              } catch(e) {
                  // sites表可能不存在
              }

              // 合并站点数量到分类数据
              const catsWithCount = categories.map(c => ({
                  ...c,
                  site_count: siteCountMap.get(c.path) || 0
              }));

              // 构建树形结构
              let tree = buildCategoryTree(catsWithCount, 0);

              // 递归汇总子分类计数到父分类（父分类显示包含子分类的总数）
              const totalSites = rollupCategoryCounts(tree);

              // 剪枝：过滤掉空分类（自身和所有子分类都没有书签的）
              tree = pruneEmptyCategories(tree);

              // 同时返回扁平列表（用于编辑书签时选择分类）
              const flatList = flattenCategoryTree(tree);

              return json({
                  code: 200,
                  data: {
                      tree: tree,
                      flat: flatList,
                      total: totalSites
                  }
              });
          } catch (e) {
              return this.errorResponse(`Failed to fetch categories: ${e.message}`, 500);
          }
      },
      async createCategory(request, env, ctx) {
          try {
              const body = await request.json();
              const name = (body.name || '').trim();
              const parentId = body.parent_id || 0;

              if (!name) {
                  return this.errorResponse('分类名称不能为空', 400);
              }
              if (name.includes('/')) {
                  return this.errorResponse('分类名称不能包含"/"', 400);
              }

              let parentPath = '';
              if (parentId && parentId !== 0) {
                  const parent = await env.NAV_DB.prepare('SELECT path FROM categories WHERE id = ?').bind(parentId).first();
                  if (!parent) {
                      return this.errorResponse('父分类不存在', 400);
                  }
                  parentPath = parent.path;
              }

              const newPath = parentPath ? parentPath + '/' + name : name;

              // 检查路径是否已存在
              const existing = await env.NAV_DB.prepare('SELECT id FROM categories WHERE path = ?').bind(newPath).first();
              if (existing) {
                  return this.errorResponse('该分类已存在', 400);
              }

              // 获取同级别最大sort_order + 1
              const maxSort = await env.NAV_DB.prepare(
                'SELECT MAX(sort_order) as max_sort FROM categories WHERE parent_id = ?'
              ).bind(parentId).first();
              const sortOrder = (maxSort && maxSort.max_sort !== null) ? maxSort.max_sort + 1 : 0;

              const result = await env.NAV_DB.prepare(
                'INSERT INTO categories (name, parent_id, path, sort_order) VALUES (?, ?, ?, ?)'
              ).bind(name, parentId, newPath, sortOrder).run();

              return json({
                  code: 201,
                  message: '分类创建成功',
                  data: {
                      id: result.meta.last_row_id,
                      name: name,
                      parent_id: parentId,
                      path: newPath,
                      sort_order: sortOrder
                  }
              });
          } catch (e) {
              return this.errorResponse(`Failed to create category: ${e.message}`, 500);
          }
      },
      async updateCategory(request, env, ctx, catId) {
          try {
              const body = await request.json();
              const cat = await env.NAV_DB.prepare('SELECT * FROM categories WHERE id = ?').bind(catId).first();
              if (!cat) {
                  return this.errorResponse('分类不存在', 404);
              }

              const newName = (body.name || '').trim();
              const newSortOrder = body.sort_order !== undefined ? normalizeSortOrder(body.sort_order) : cat.sort_order;

              if (newName && newName !== cat.name) {
                  if (newName.includes('/')) {
                      return this.errorResponse('分类名称不能包含"/"', 400);
                  }
                  // 构建新路径
                  const oldPath = cat.path;
                  const pathParts = oldPath.split('/');
                  pathParts[pathParts.length - 1] = newName;
                  const newPath = pathParts.join('/');

                  // 检查新路径是否与其他分类冲突
                  const existing = await env.NAV_DB.prepare('SELECT id FROM categories WHERE path = ? AND id != ?').bind(newPath, catId).first();
                  if (existing) {
                      return this.errorResponse('该分类名称已存在', 400);
                  }

                  // 更新分类自身
                  await env.NAV_DB.prepare(
                    'UPDATE categories SET name = ?, path = ?, sort_order = ? WHERE id = ?'
                  ).bind(newName, newPath, newSortOrder, catId).run();

                  // 更新所有子分类的路径
                  const oldPrefix = oldPath + '/';
                  const newPrefix = newPath + '/';
                  const { results: children } = await env.NAV_DB.prepare(
                    'SELECT id, path FROM categories WHERE path LIKE ?'
                  ).bind(oldPrefix + '%').all();
                  for (const child of children) {
                      const childNewPath = newPrefix + child.path.substring(oldPrefix.length);
                      await env.NAV_DB.prepare('UPDATE categories SET path = ? WHERE id = ?').bind(childNewPath, child.id).run();
                  }

                  // 更新sites表中使用该路径的书签
                  await env.NAV_DB.prepare(
                    'UPDATE sites SET catelog = ? WHERE catelog = ?'
                  ).bind(newPath, oldPath).run();
                  // 更新子分类路径的书签
                  for (const child of children) {
                      const oldChildPath = child.path;
                      const newChildPath = newPrefix + oldChildPath.substring(oldPrefix.length);
                      await env.NAV_DB.prepare(
                        'UPDATE sites SET catelog = ? WHERE catelog = ?'
                      ).bind(newChildPath, oldChildPath).run();
                  }
              } else {
                  // 只更新排序
                  await env.NAV_DB.prepare(
                    'UPDATE categories SET sort_order = ? WHERE id = ?'
                  ).bind(newSortOrder, catId).run();
              }

              return json({
                  code: 200,
                  message: '分类更新成功'
              });
          } catch (e) {
              return this.errorResponse(`Failed to update category: ${e.message}`, 500);
          }
      },
      async deleteCategory(request, env, ctx, catId) {
          try {
              const cat = await env.NAV_DB.prepare('SELECT * FROM categories WHERE id = ?').bind(catId).first();
              if (!cat) {
                  return this.errorResponse('分类不存在', 404);
              }

              // 检查是否有子分类
              const { results: children } = await env.NAV_DB.prepare(
                'SELECT id FROM categories WHERE parent_id = ?'
              ).bind(catId).all();
              if (children.length > 0) {
                  return this.errorResponse('该分类下有子分类，请先删除子分类', 400);
              }

              // 检查是否有书签
              const siteCount = await env.NAV_DB.prepare(
                'SELECT COUNT(*) as cnt FROM sites WHERE catelog = ?'
              ).bind(cat.path).first();
              if (siteCount && siteCount.cnt > 0) {
                  return this.errorResponse('该分类下有书签，请先移动或删除书签', 400);
              }

              await env.NAV_DB.prepare('DELETE FROM categories WHERE id = ?').bind(catId).run();

              return json({
                  code: 200,
                  message: '分类删除成功'
              });
          } catch (e) {
              return this.errorResponse(`Failed to delete category: ${e.message}`, 500);
          }
      },
      async moveCategory(request, env, ctx, catId) {
          try {
              const body = await request.json();
              const direction = body.direction; // 'up' or 'down'
              if (direction !== 'up' && direction !== 'down') {
                  return this.errorResponse('direction必须是up或down', 400);
              }

              const cat = await env.NAV_DB.prepare('SELECT * FROM categories WHERE id = ?').bind(catId).first();
              if (!cat) {
                  return this.errorResponse('分类不存在', 404);
              }

              // 获取所有同级分类，按sort_order排序，同序按id排序
              const { results: siblings } = await env.NAV_DB.prepare(
                'SELECT id, sort_order FROM categories WHERE parent_id = ? ORDER BY sort_order ASC, id ASC'
              ).bind(cat.parent_id).all();

              const currentIndex = siblings.findIndex(s => s.id === catId);
              if (currentIndex === -1) {
                  return this.errorResponse('分类数据异常', 500);
              }

              const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
              if (targetIndex < 0 || targetIndex >= siblings.length) {
                  return this.errorResponse('无法移动到该位置', 400);
              }

              // 交换位置
              const newSiblings = [...siblings];
              [newSiblings[currentIndex], newSiblings[targetIndex]] = [newSiblings[targetIndex], newSiblings[currentIndex]];

              // 重新分配连续的sort_order值，确保唯一性
              for (let i = 0; i < newSiblings.length; i++) {
                  await env.NAV_DB.prepare(
                    'UPDATE categories SET sort_order = ? WHERE id = ?'
                  ).bind(i, newSiblings[i].id).run();
              }

              return json({
                  code: 200,
                  message: '移动成功'
              });
          } catch (e) {
              return this.errorResponse(`Failed to move category: ${e.message}`, 500);
          }
      },
      async updateCategoryOrder(request, env, ctx, categoryName) {
          try {
              const body = await request.json();
              if (!categoryName) {
                  return this.errorResponse('Category name is required', 400);
              }

              const normalizedCategory = categoryName.trim();
              if (!normalizedCategory) {
                  return this.errorResponse('Category name is required', 400);
              }

              if (body && body.reset) {
                  await env.NAV_DB.prepare('DELETE FROM category_orders WHERE catelog = ?')
                      .bind(normalizedCategory)
                      .run();
                  return json({
                      code: 200,
                      message: 'Category order reset successfully'
                  });
              }

              const sortOrderValue = normalizeSortOrder(body ? body.sort_order : undefined);
              await env.NAV_DB.prepare(`
                INSERT INTO category_orders (catelog, sort_order)
                VALUES (?, ?)
                ON CONFLICT(catelog) DO UPDATE SET sort_order = excluded.sort_order
              `).bind(normalizedCategory, sortOrderValue).run();

              return json({
                  code: 200,
                  message: 'Category order updated successfully'
              });
          } catch (e) {
              return this.errorResponse(`Failed to update category order: ${e.message}`, 500);
          }
      },
      async logout(request, env, ctx) {
          try {
              const cookies = parseCookies(request.headers.get('Cookie') || '');
              const token = cookies[SESSION_COOKIE_NAME];
              
              // 销毁会话
              if (token) {
                  await destroyAdminSession(env, token);
              }
              
              // 清除 cookie（设置 Max-Age=0 会立即删除 cookie）
              const clearCookie = buildSessionCookie('', { maxAge: 0 });
              
              return json({
                  code: 200,
                  message: 'Logged out successfully'
              }, 200, { 'Set-Cookie': clearCookie });
          } catch (e) {
              return this.errorResponse(`Failed to logout: ${e.message}`, 500);
          }
      },
      // 站点设置：账号密码、图标 API、站点名称。只给已登录的管理员读写
      async getSettings(request, env, ctx) {
          try {
              const s = await readSettings(env);
              const faviconApi = getIconApiUrl(env, s);
              return json({ code: 200, data: {
                  admin_user: s.admin_user, favicon_api: faviconApi,
                  site_title: s.site_title, site_subtitle: s.site_subtitle
              } });
          } catch (e) {
              return this.errorResponse(`Failed to read settings: ${e.message}`, 500);
          }
      },
      async updateSettings(request, env, ctx) {
          try {
              const body = await request.json().catch(() => ({}));
              const patch = {};
              const user = String(body.admin_user || '').trim();
              if (user) patch.admin_user = user;
              // 改密码：仅需已登录的会话
              const nextPass = String(body.admin_pass || '').trim();
              if (nextPass) {
                  if (nextPass.length < 4) return this.errorResponse('新密码至少 4 位', 400);
                  patch.admin_pass = nextPass;
              }
              if (body.favicon_api !== undefined) patch.favicon_api = String(body.favicon_api || '').trim() || SETTINGS_DEFAULTS.favicon_api;
              if (body.site_title !== undefined) patch.site_title = String(body.site_title || '').trim() || SETTINGS_DEFAULTS.site_title;
              if (body.site_subtitle !== undefined) patch.site_subtitle = String(body.site_subtitle || '').trim();
              if (!Object.keys(patch).length) return this.errorResponse('没有需要保存的修改', 400);
              await writeSettings(env, patch);
              return json({ code: 200, message: 'Settings saved' });
          } catch (e) {
              return this.errorResponse(`Failed to save settings: ${e.message}`, 500);
          }
      },
       errorResponse(message, status) {
          return json({code: status, message: message}, status);
      }
    };
  
  
  /**
   * 处理后台管理页面请求
   */
  const admin = {
  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);



    if (url.pathname === '/admin') {
      if (request.method === 'POST') {
        const formData = await request.formData();
        const name = (formData.get('name') || '').trim();
        const password = (formData.get('password') || '').trim();

        // 账号密码存在 D1 的 settings 表，首次启动是 admin / admin，登录后可在后台改
        const stored = await readSettings(env);
        const storedUsername = stored.admin_user || 'admin';
        const storedPassword = stored.admin_pass || 'admin';
        // 环境变量留作救援通道：设了 ADMIN_USERNAME / ADMIN_PASSWORD 就额外接受这一组
        const rescueUsername = env.ADMIN_USERNAME;
        const rescuePassword = env.ADMIN_PASSWORD;

        const isValid =
          (name === storedUsername && password === storedPassword) ||
          Boolean(rescueUsername && rescuePassword &&
            name === rescueUsername && password === rescuePassword);

        if (isValid) {
          const token = await createAdminSession(env);
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/admin',
              'Set-Cookie': buildSessionCookie(token),
            },
          });
        }

        return this.renderLoginPage('账号或密码错误，请重试。');
      }

      const session = await validateAdminSession(request, env);
      if (session.authenticated) {
        return this.renderAdminPage(env);
      }

      return this.renderLoginPage();
    }
    
    if (url.pathname.startsWith('/static')) {
      return this.handleStatic(request, env, ctx);
    }
    
    return new Response('页面不存在', {status: 404});
  },
     async handleStatic(request, env, ctx) {
        const url = new URL(request.url);
        const filePath = url.pathname.replace('/static/', '');
  
        let contentType = 'text/plain';
        if (filePath.endsWith('.css')) {
           contentType = 'text/css';
        } else if (filePath.endsWith('.js')) {
           contentType = 'application/javascript';
        }
  
        try {
            const fileContent = await this.getFileContent(filePath)
            const etag = staticEtag(filePath, fileContent);
            if (request.headers.get('If-None-Match') === etag) {
                return new Response(null, {
                    status: 304,
                    headers: { 'ETag': etag, 'Cache-Control': 'no-cache' }
                });
            }
            return new Response(fileContent, {
              headers: { 'Content-Type': contentType, 'ETag': etag, 'Cache-Control': 'no-cache' }
            });
        } catch (e) {
           return new Response('Not Found', {status: 404});
        }
  
      },
    async getFileContent(filePath) {
        const fileContents = {
           'admin.html': `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>书签管理</title>
      <link rel="icon" href="data:image/webp;base64,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" type="image/webp"/>
      <link rel="stylesheet" href="/static/admin.css">
      <script>
        // 全局配置
        const faviconApi = 'https://toolb.cn/favicon/{domain}';
      </script>
    </head>
    <body>
      <div class="container">
          <header class="admin-header">
            <div class="admin-header-left">
              <h1>书签管理</h1>
            </div>
            <div class="admin-toolbar">
              <input type="file" id="importFile" accept=".json" style="display:none;">
              <button id="addBtn" class="toolbar-btn toolbar-btn-add" title="添加新书签">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>添加</span>
              </button>
              <button id="importBtn" class="toolbar-btn toolbar-btn-import" title="导入书签">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>导入</span>
              </button>
              <button id="exportBtn" class="toolbar-btn toolbar-btn-export" title="导出书签">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <span>导出</span>
              </button>
              <button id="settingsBtn" class="toolbar-btn toolbar-btn-settings" title="站点设置">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                <span>设置</span>
              </button>
              <button id="logoutBtn" class="toolbar-btn toolbar-btn-logout" title="退出登录">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                <span>退出</span>
              </button>
            </div>
          </header>
      
          <div id="message" style="display: none;padding:1rem;border-radius: 0.5rem;margin-bottom: 1rem;"></div>
          <div class="modal" id="addModal" style="display:none;">
            <div class="modal-content">
              <span class="modal-close" id="addModalClose">×</span>
              <h2>添加站点</h2>
              <form id="addForm">
                <label for="addName">名称:</label>
                <input type="text" id="addName" placeholder="名称" required>
                <label for="addUrl">网址:</label>
                <input type="text" id="addUrl" placeholder="网址" required>
                <label for="addLogo">图标(可选):</label>
                <input type="text" id="addLogo" placeholder="图标(可选)">
                <label for="addDesc">描述(可选):</label>
                <input type="text" id="addDesc" placeholder="描述(可选)">
                <label for="addCatelog">分类:</label>
                <input type="hidden" id="addCatelog">
                <div id="addCatelogCascader" class="cascader-host"></div>
                <label for="addSortOrder">排序:</label>
                <input type="number" id="addSortOrder" placeholder="数字小靠前 (可选)">
                <button type="submit">添加</button>
              </form>
            </div>
          </div>
          <div class="modal" id="settingsModal" style="display:none;">
            <div class="modal-content">
              <span class="modal-close" id="settingsModalClose">×</span>
              <h2>站点设置</h2>
              <form id="settingsForm">
                <label for="setTitle">站点名称</label>
                <input type="text" id="setTitle" placeholder="默认 琪舟阁">
                <label for="setSubtitle">副标题</label>
                <input type="text" id="setSubtitle" placeholder="显示在首页顶部">
                <label for="setFavicon">图标 API</label>
                <input type="text" id="setFavicon" placeholder="默认 https://toolb.cn/favicon/{domain}">
                <label for="setUser">用户名</label>
                <input type="text" id="setUser" autocomplete="username" placeholder="默认 admin">
                <label for="setNewPass">密码</label>
                <input type="password" id="setNewPass" autocomplete="new-password" placeholder="不修改就留空">
                <p class="settings-error" id="settingsError" style="display:none;"></p>
                <button type="submit">保存</button>
              </form>
            </div>
          </div>
          <div class="modal" id="logoutModal" style="display:none;">
            <div class="modal-content modal-confirm">
              <h2>退出登录</h2>
              <div class="confirm-actions">
                <button type="button" class="confirm-btn" id="logoutCancel">取消</button>
                <button type="button" class="confirm-btn confirm-btn-danger" id="logoutConfirm">退出</button>
              </div>
            </div>
          </div>
          <div class="modal" id="batchMoveModal" style="display:none;">
            <div class="modal-content">
              <span class="modal-close" id="batchMoveClose">×</span>
              <h2 id="batchMoveTitle">迁移分类</h2>
              <input type="hidden" id="batchCatelog">
              <div id="batchCatelogCascader" class="cascader-host"></div>
              <div class="confirm-actions">
                <button type="button" class="confirm-btn" id="batchMoveCancel">取消</button>
                <button type="button" class="confirm-btn confirm-btn-primary" id="batchMoveConfirm">迁移</button>
              </div>
            </div>
          </div>
          <div class="modal" id="batchDeleteModal" style="display:none;">
            <div class="modal-content modal-confirm">
              <h2 id="batchDeleteTitle">删除书签</h2>
              <div class="confirm-actions">
                <button type="button" class="confirm-btn" id="batchDeleteCancel">取消</button>
                <button type="button" class="confirm-btn confirm-btn-danger" id="batchDeleteConfirm">删除</button>
              </div>
            </div>
          </div>
         <div id="config">
                    <div class="config-layout">
                      <aside class="category-sidebar collapsed">
                        <div class="category-sidebar-header">
                          <h3>分类列表</h3>
                          <button id="toggleCategorySidebar" title="展开分类">&#x203A;</button>
                        </div>
                        <ul id="categorySidebarList" class="category-sidebar-list">
                          <li class="category-sidebar-item active" data-category="" data-level="0">
                            <span class="cat-toggle" style="visibility:hidden">&#x25B6;</span>
                            <span class="cat-label">全部</span>
                            <span class="cat-count"></span>
                          </li>
                        </ul>
                      </aside>
                      <div class="config-main">
                        <div class="batch-bar" id="batchBar">
                          <span class="batch-count" id="batchCount">已选 0 项</span>
                          <button type="button" class="batch-btn" id="batchPickAll">
                            <svg id="batchPickIconAll" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            <svg id="batchPickIconClear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="display:none"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            <span id="batchPickAllText">全选</span>
                          </button>
                          <button type="button" class="batch-btn" id="batchMoveBtn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
                            迁移分类
                          </button>
                          <button type="button" class="batch-btn" id="batchReorderBtn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" /></svg>
                            重新排序
                          </button>
                          <button type="button" class="batch-btn" id="batchExportBtn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            导出选中
                          </button>
                          <button type="button" class="batch-btn batch-btn-danger" id="batchDeleteBtn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                            删除所选
                          </button>
                        </div>
                        <div class="table-wrapper">
                        <table id="configTable">
                            <thead>
                                <tr>
                                  <th class="col-select"><input type="checkbox" id="selectAllPage" title="全选本页"></th>
                                  <th>名称</th>
                                  <th>网址</th>
                                  <th>图标</th>
                                  <th>描述</th>
                                  <th>分类</th>
                                  <th>排序</th>
                                  <th>操作</th>
                                </tr>
                            </thead>
                            <tbody id="configTableBody">
                              <!-- data render by js -->
                            </tbody>
                        </table>
                   </div>
                        <div class="pagination">
                              <button id="prevPage" disabled>上一页</button>
                              <span id="currentPage">1</span>/<span id="totalPages">1</span>
                              <button id="nextPage" disabled>下一页</button>
                        </div>
                      </div>
                    </div>
                </div>
      </div>
      <script src="/static/admin.js"></script>
    </body>
    </html>`,
            'admin.css': `* { -webkit-tap-highlight-color: transparent; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Noto Sans SC', sans-serif; margin: 0; padding: 10px; background: #fdf8f3; min-height: 100vh; color: #2d3748; }
    /* 自定义滚动条 */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; border-radius: 10px; }
    ::-webkit-scrollbar-thumb { background: rgba(108, 143, 186, 0.3); border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(65, 109, 157, 0.5); }
    .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: fadeIn 0.2s ease; }
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    .modal-content { background: #ffffff; margin: 8% auto; padding: 24px; border: 1px solid #e6e8ec; width: 85%; max-width: 560px; border-radius: 12px; position: relative; box-shadow: 0 12px 40px rgba(16, 24, 40, 0.16); animation: slideUp 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); }
    @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .modal-close { color: #a0aec0; position: absolute; right: 16px; top: 12px; font-size: 24px; font-weight: bold; cursor: pointer; transition: all 0.2s; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
    .modal-close:hover,
    .modal-close:focus { color: #4a5568; background: rgba(0,0,0,0.05); }
    .modal-content form { display: flex; flex-direction: column; gap: 4px; }
    .modal-content form label { margin-bottom: 2px; font-weight: 500; color: #4a5568; font-size: 0.9rem; }
    .modal-content form input { padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.95rem; outline: none; transition: all 0.2s ease; background: rgba(255,255,255,0.8); }
    .modal-content form input:focus { border-color: #4d7cab; box-shadow: 0 0 0 3px rgba(65, 109, 157, 0.12); background: #fff; }
    .modal-content button[type='submit'] { margin-top: 8px; background: #3e6b9b; color: #fff; border: none; padding: 10px 18px; border-radius: 10px; cursor: pointer; font-size: 0.95rem; font-weight: 500; transition: background 0.2s ease; }
    .modal-content button[type='submit']:hover { background: #355d88; }
.container { max-width: 1280px; margin: 0 auto; background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); padding: 24px; border-radius: 16px; box-shadow: 0 4px 24px rgba(16, 24, 40, 0.06); border: 1px solid rgba(226, 232, 240, 0.9); }
    .admin-header { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
    .admin-header-left { flex: 1; }
    @media (min-width: 768px) {
        .admin-header { flex-direction: row; align-items: center; justify-content: space-between; }
    }
    h1 { font-size: 1.6rem; margin: 0; color: #2d3748; font-weight: 700; }
    
    /* 工具栏图标按钮 */
    .admin-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .toolbar-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-weight: 600; background: #fff; color: #3e6b9b; transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
    .toolbar-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
    .toolbar-btn:hover { box-shadow: 0 3px 10px rgba(48, 85, 128, 0.12); }
    .toolbar-btn:active { transform: translateY(1px); }
    .toolbar-btn-add { background: #3e6b9b; border-color: #3e6b9b; color: #fff; }
    .toolbar-btn-add:hover { background: #31597f; border-color: #31597f; filter: none; }
    .toolbar-btn-import,
    .toolbar-btn-export { background: #fff; border-color: #dbe4ef; color: #3e6b9b; }
    .toolbar-btn-import:hover,
    .toolbar-btn-export:hover { background: #eef3f9; border-color: #c6d5e6; filter: none; }
    .toolbar-btn-logout { background: #fff; border-color: #ecdbd8; color: #b0473f; }
    .toolbar-btn-logout:hover { background: #fdf4f3; border-color: #e3c4c0; filter: none; }
    .toolbar-btn-settings { background: #fff; border-color: #dbe4ef; color: #3e6b9b; }
    .toolbar-btn-settings:hover { background: #eef3f9; border-color: #c6d5e6; filter: none; }
    .modal-content h2 { margin: 0 0 16px; font-size: 1.15rem; color: #2d3748; font-weight: 600; }
    .modal-confirm { max-width: 340px; margin-top: 18%; }
    .confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .confirm-btn { padding: 9px 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #4a5568; font-family: inherit; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease; }
    .confirm-btn:hover { background: #f7fafc; border-color: #d5dbe3; }
    .confirm-btn-danger { background: #b8443a; border-color: #b8443a; color: #fff; }
    .confirm-btn-danger:hover { background: #a13a31; border-color: #a13a31; color: #fff; }
    .confirm-btn-primary { background: #3e6b9b; border-color: #3e6b9b; color: #fff; }
    .confirm-btn-primary:hover { background: #355d88; border-color: #355d88; color: #fff; }
    .settings-error { margin: 4px 0 0; padding: 8px 10px; border-radius: 8px; background: #fdf2f2; color: #b42318; font-size: 0.85rem; line-height: 1.4; }
    @media (max-width: 480px) {
        .toolbar-btn span { display: none; }
        .toolbar-btn { padding: 10px 12px; border-radius: 10px; }
        .toolbar-btn svg { width: 20px; height: 20px; }
        .container { padding: 16px; border-radius: 16px; }
    }

    #message { border-radius: 8px; padding: 10px 14px; font-size: 13px; animation: slideDown 0.3s ease; }

    #config { border: 1px solid #e6e8ec; border-radius: 12px; padding: 12px; background: #fff; }
    
    @keyframes slideDown {
        from { opacity: 0; transform: translateY(-12px); }
        to { opacity: 1; transform: translateY(0); }
    }
 input[type="text"], input[type="number"] { padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.95rem; outline: none; margin-bottom: 5px; transition: all 0.2s ease; background: rgba(255,255,255,0.8); }
    input[type="text"]:focus, input[type="number"]:focus { border-color: #4d7cab; box-shadow: 0 0 0 3px rgba(65, 109, 157, 0.12); background: #fff; }

    /* 级联分类选择器 */
    .cascader-host { width: 100%; }
    .cascader-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid #e2e8f0; border-radius: 10px; min-height: 42px; transition: all 0.2s ease; }
    .cascader-wrap:has(input:focus) { border-color: #4d7cab; box-shadow: 0 0 0 3px rgba(65,109,157,0.12); }
    .cascader-wrap input { padding: 7px 10px !important; margin: 0 !important; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.88rem; background: #fff; outline: none; transition: all 0.2s ease; max-width: 200px; color: #334155; }
    .cascader-wrap input:focus { border-color: #4d7cab; box-shadow: 0 0 0 3px rgba(65,109,157,0.12); }
    .cs-select { position: relative; max-width: 220px; }
    .cs-trigger { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 6px 9px; border: 1px solid #c3d0e3; border-radius: 8px; background: #eef3f9; color: #31597f; font-family: inherit; font-size: 0.88rem; font-weight: 500; line-height: 1.3; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
    .cs-trigger:hover { border-color: #9fb4cf; background: #e7eef7; }
    .cs-select.open .cs-trigger { border-color: #4d7cab; background: #fff; box-shadow: 0 0 0 3px rgba(65,109,157,0.12); }
    .cs-trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-caret { width: 12px; height: 12px; flex: none; color: #7d8fa6; transition: transform 0.15s ease; }
    .cs-select.open .cs-caret { transform: rotate(180deg); }
    .cs-select-dashed .cs-trigger { border: 1px dashed #a9bdd6; background: #fff; color: #4d7cab; font-weight: 400; }
    .cs-select-dashed .cs-trigger:hover { border-color: #7d9dbf; background: #f8fafc; }
    .cs-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 60; display: none; min-width: 100%; width: max-content; max-width: 260px; max-height: 232px; overflow-y: auto; padding: 4px; background: #fff; border: 1px solid #e5e8ee; border-radius: 10px; box-shadow: 0 10px 28px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.05); }
    .cs-select.open .cs-menu { display: block; }
    .cs-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; margin: 0; padding: 7px 9px; border: 0; border-radius: 6px; background: none; color: #334155; font-family: inherit; font-size: 0.88rem; font-weight: 400; text-align: left; white-space: nowrap; cursor: pointer; transition: background 0.12s ease; }
    .cs-option:hover { background: #f1f5f9; }
    .cs-option.is-selected { background: #eaf0f8; color: #1f3f66; font-weight: 600; }
    .cs-option-count { color: #94a3b8; font-size: 0.78rem; font-weight: 400; }
    .cs-option-action { margin-top: 4px; border-top: 1px solid #eef1f5; border-radius: 0 0 6px 6px; color: #4d7cab; }
    .cascader-sep { color: #94a3b8; font-size: 0.85rem; padding: 0 2px; }
    .cascader-remove { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(229,62,62,0.12); color: #e53e3e; cursor: pointer; font-size: 14px; line-height: 1; transition: all 0.2s ease; margin-right: 2px; user-select: none; }
    .cascader-remove:hover { background: rgba(229,62,62,0.28); transform: scale(1.12); }
    .cascader-ok { padding: 7px 12px !important; margin: 0 !important; background: #3e6b9b !important; border-radius: 8px !important; font-size: 0.82rem !important; box-shadow: none; }
    .cascader-ok:hover { background: #355d88 !important; }
    .cascader-path { margin-top: 6px; font-size: 0.8rem; color: #64748b; display: flex; align-items: center; gap: 6px; }
    .cascader-path-label { font-weight: 600; color: #4d7cab; }
    .cascader-path-value { color: #475569; word-break: break-all; }
    button { background: #3e6b9b; color: #fff; border: none; padding: 9px 16px; border-radius: 10px; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: background 0.2s ease; }
    button:hover { background: #355d88; }
    button:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .table-wrapper { overflow: auto; border-radius: 12px; flex: 1 1 auto; min-height: 0; }
    table { width: 100%; min-width: 1080px; table-layout: fixed; border-collapse: separate; border-spacing: 0; margin-bottom: 16px; border-radius: 12px; overflow: hidden; }
    th, td { border-bottom: 1px solid rgba(226, 232, 240, 0.6); padding: 12px 14px; text-align: left; color: #4a5568; white-space: nowrap; }
    /* 固定列宽：勾选 / 名称 / 网址 / 图标 / 描述 / 分类 / 排序 / 操作 */
    #configTable th:nth-child(1) { width: 40px; }
    #configTable th:nth-child(2) { width: 120px; }
    #configTable th:nth-child(3) { width: 220px; }
    #configTable th:nth-child(4) { width: 60px; }
    #configTable th:nth-child(5) { width: 180px; }
    #configTable th:nth-child(6) { width: 110px; }
    #configTable th:nth-child(7) { width: 56px; }
    #configTable th:nth-child(8) { width: 130px; }
    .col-select { width: 40px; padding-left: 12px !important; padding-right: 6px !important; text-align: center; }
    .col-select input[type="checkbox"] { width: 15px; height: 15px; margin: 0; accent-color: #3e6b9b; cursor: pointer; vertical-align: middle; }
    tbody tr.selected { background: rgba(77, 124, 171, 0.08); }
    tbody tr.selected:hover { background: rgba(77, 124, 171, 0.12); }
    /* 批量操作条：有选中项时出现 */
    .batch-bar { display: none; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 12px; margin-bottom: 10px; border: 1px solid #e4eaf3; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(31, 51, 78, 0.04); font-size: 0.84rem; color: #33465e; }
    .batch-bar.visible { display: flex; }
    .batch-count { display: inline-flex; align-items: center; gap: 7px; padding-right: 12px; margin-right: 2px; border-right: 1px solid #e9eef6; font-weight: 600; color: #2f4a67; }
    .batch-count::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #4d7cab; }
    .batch-btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border: 1px solid #dbe2ec; border-radius: 8px; background: #fff; color: #33465e; font-family: inherit; font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease; }
    .batch-btn svg { width: 14px; height: 14px; opacity: 0.72; }
    .batch-btn:hover { background: #f7fafd; border-color: #b9c9dc; color: #2f4a67; filter: none; transform: none; }
    .batch-btn-danger { border-color: #e8cbc6; color: #a2402f; }
    .batch-btn-danger svg { opacity: 0.85; }
    .batch-btn-danger:hover { background: #fdf5f4; border-color: #dbb0a9; color: #8f3527; }
    /* 单行显示，超出部分在格子里横向滑动，不换行、不撑高行 */
    td .cell { overflow-x: auto; overflow-y: hidden; white-space: nowrap; /* 常驻 3px 横向拖动条，只有内容溢出时才出现 */ /* 别加 scrollbar-width/color，会让下面 ::-webkit-scrollbar 全部失效 */ margin-bottom: -3px; }
    td .cell::-webkit-scrollbar { height: 3px; }
    td .cell::-webkit-scrollbar-button,
    td .cell::-webkit-scrollbar-button:horizontal:decrement,
    td .cell::-webkit-scrollbar-button:horizontal:increment { display: none; width: 0; height: 0; }
    td .cell::-webkit-scrollbar-track { background: transparent; }
    td .cell::-webkit-scrollbar-thumb { background: rgba(65, 109, 157, 0.45); border-radius: 2px; }
    td .cell::-webkit-scrollbar-thumb:hover { background: rgba(65, 109, 157, 0.62); }
    th { background: rgba(65, 109, 157, 0.08); font-weight: 600; color: #4a5568; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
    tr { transition: background 0.15s ease; }
    tbody tr:hover { background: rgba(65, 109, 157, 0.04); }
    tr:nth-child(even) { background: rgba(247, 250, 252, 0.5); }
    tr:nth-child(even):hover { background: rgba(65, 109, 157, 0.06); }
    .pagination { text-align: center; margin-top: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; flex: 0 0 auto; }
    .pagination button { margin: 0; background: rgba(255,255,255,0.8); color: #4a5568; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 16px; font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .pagination button:hover:not(:disabled) { background: #fff; border-color: #cbd5e0; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
    .pagination span { color: #4a5568; font-size: 0.9rem; }
    
    .success { background: #f2f7f4; color: #2f6b4e; border: 1px solid #d6e5db; }
    .error { background: #fbf3f2; color: #96382f; border: 1px solid #eed6d2; }
    
    /* 分类侧边栏布局 */
    .config-layout { display: flex; gap: 16px; height: calc(100vh - 170px); min-height: 440px; }
    .category-sidebar { flex: 0 0 220px; background: rgba(255,255,255,0.5); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 14px; padding: 14px; border: 1px solid rgba(226, 232, 240, 0.5); overflow-y: auto; max-height: none; }
    .category-sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(226, 232, 240, 0.5); }
    .category-sidebar-header h3 { margin: 0; font-size: 0.95rem; color: #2d3748; font-weight: 600; }
    #toggleCategorySidebar { background: none; border: none; font-size: 1.15rem; line-height: 1; cursor: pointer; color: #a0aec0; padding: 4px 8px; border-radius: 8px; transition: all 0.2s; width: auto; }
    #toggleCategorySidebar:hover { background: rgba(65, 109, 157, 0.1); color: #4d7cab; }
    .category-sidebar { transition: flex-basis 0.22s ease, padding 0.22s ease; }
    .category-sidebar.collapsed { flex: 0 0 42px; padding: 10px 5px; overflow: hidden; }
    .category-sidebar.collapsed .category-sidebar-header { justify-content: center; border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .category-sidebar.collapsed .category-sidebar-header h3,
    .category-sidebar.collapsed .category-sidebar-list { display: none; }
    .category-sidebar-list { list-style: none; padding: 0; margin: 0; }
    .category-sidebar-item { padding: 7px 10px; cursor: pointer; border-radius: 10px; margin-bottom: 2px; font-size: 0.87rem; color: #4a5568; transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1); display: flex; align-items: center; gap: 4px; position: relative; user-select: none; }
    .category-sidebar-item:hover { background: rgba(65, 109, 157, 0.08); color: #4d7cab; padding-left: 14px; }
    .category-sidebar-item.active { background: #e7eef7; color: #2f5c8a; font-weight: 600; box-shadow: none; }
    .category-sidebar-item .cat-toggle { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-size: 0.6rem; transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0; color: #a0aec0; }
    .category-sidebar-item .cat-toggle.expanded { transform: rotate(90deg); }
    .category-sidebar-item.active .cat-toggle { color: rgba(255,255,255,0.8); }
    .category-sidebar-item .cat-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .category-sidebar-item .cat-count { font-size: 0.7rem; background: rgba(0,0,0,0.06); padding: 1px 7px; border-radius: 10px; flex-shrink: 0; font-weight: 500; }
    .category-sidebar-item.active .cat-count { background: rgba(255,255,255,0.25); }
    .category-sidebar-item .cat-sort-actions { display: none; gap: 2px; flex-shrink: 0; margin-left: 2px; }
    .category-sidebar-item:hover .cat-sort-actions { display: inline-flex; }
    .category-sidebar-item .cat-sort-btn { width: 20px; height: 20px; border: none; background: rgba(0,0,0,0.05); border-radius: 6px; cursor: pointer; font-size: 0.55rem; color: #718096; display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 1; transition: all 0.15s ease; }
    .category-sidebar-item .cat-sort-btn:hover:not(.disabled) { background: #3e6b9b; color: #fff; transform: scale(1.1); }
    .category-sidebar-item .cat-sort-btn.disabled { opacity: 0.3; cursor: not-allowed; }
    .category-sidebar-item.active .cat-sort-btn { background: rgba(255,255,255,0.2); color: #fff; }
    .category-sidebar-item.active .cat-sort-btn:hover:not(.disabled) { background: rgba(255,255,255,0.35); }
    .category-sidebar-children { list-style: none; padding: 0; margin: 0; overflow: hidden; }
    .category-sidebar-children.collapsed { display: none; }
    .config-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    /* 操作按钮 */
    .actions { display: flex; gap: 6px; flex-wrap: nowrap; }
    .actions button { padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; font-weight: 500; white-space: nowrap; flex: 0 0 auto; }
    .edit-btn { background: #fff !important; color: #3e6b9b !important; border: 1px solid #dbe4ef !important; box-shadow: none; }
    .edit-btn:hover { background: #eef3f9 !important; border-color: #c6d5e6 !important; }
    .del-btn { background: #fff !important; color: #b0473f !important; border: 1px solid #ecdbd8 !important; box-shadow: none; }
    .del-btn:hover { background: #fdf4f3 !important; border-color: #e3c4c0 !important; }
    /* 搜索框 */
    .search-input { width: 100%; box-sizing: border-box; border-radius: 12px !important; background: rgba(255,255,255,0.7) !important; }
    @media (max-width: 768px) {
        .config-layout { flex-direction: column; height: auto; min-height: 0; }
        .category-sidebar { flex: none; max-height: 200px; }
    }
      `,
          'admin.js': `
          const configTableBody = document.getElementById('configTableBody');
          const prevPageBtn = document.getElementById('prevPage');
          const nextPageBtn = document.getElementById('nextPage');
          const currentPageSpan = document.getElementById('currentPage');
          const totalPagesSpan = document.getElementById('totalPages');
          
          const messageDiv = document.getElementById('message');
          
          var escapeHTML = function(value) {
            var result = '';
            if (value !== null && value !== undefined) {
              result = String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            }
            return result;
          };
          
          var normalizeUrl = function(value) {
            var trimmed = String(value || '').trim();
            var normalized = '';
            if (/^https?:\\/\\//i.test(trimmed)) {
              normalized = trimmed;
            } else if (/^[\\w.-]+\\.[\\w.-]+/.test(trimmed)) {
              normalized = 'https://' + trimmed;
            }
            return normalized;
          };
          
          const addBtn = document.getElementById('addBtn');
          const addModal = document.getElementById('addModal');
          const addModalClose = document.getElementById('addModalClose');
          const addForm = document.getElementById('addForm');
          const addName = document.getElementById('addName');
          const addUrl = document.getElementById('addUrl');
          const addLogo = document.getElementById('addLogo');
          const addDesc = document.getElementById('addDesc');
          const addCatelog = document.getElementById('addCatelog');
          const addSortOrder = document.getElementById('addSortOrder');
          const importBtn = document.getElementById('importBtn');
          const importFile = document.getElementById('importFile');
          const exportBtn = document.getElementById('exportBtn');
          
          // 分类侧边栏（树形结构）
          const categorySidebarList = document.getElementById('categorySidebarList');
          const toggleCategorySidebarBtn = document.getElementById('toggleCategorySidebar');
          let selectedCategory = '';
          let categoryTree = [];
          let flatCategories = [];
          let totalSitesCount = 0;
          let expandedCategories = new Set(); // 记录展开的分类ID

          function loadCategorySidebar() {
            if (!categorySidebarList) return;
            fetch('/api/categories', { cache: 'no-store' })
              .then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  categoryTree = data.data.tree || [];
                  flatCategories = data.data.flat || [];
                  totalSitesCount = data.data.total || 0;
                  renderCategorySidebar();
                  updateCatelogDatalist();
                }
              });
          }

          function countAllSites() {
            return totalSitesCount;
          }

          function renderCategorySidebar() {
            if (!categorySidebarList) return;
            categorySidebarList.innerHTML = '';
            
            // 渲染"全部"项
            const allItem = document.createElement('li');
            allItem.className = 'category-sidebar-item' + (selectedCategory === '' ? ' active' : '');
            allItem.setAttribute('data-category', '');
            allItem.setAttribute('data-level', '0');
            allItem.innerHTML = '<span class="cat-toggle" style="visibility:hidden">&#x25B6;</span><span class="cat-label">全部</span><span class="cat-count">' + countAllSites() + '</span>';
            allItem.addEventListener('click', (e) => {
              selectCategory('');
            });
            categorySidebarList.appendChild(allItem);

            // 递归渲染树
            renderTreeNodes(categoryTree, categorySidebarList, 0, categoryTree);
          }

          function renderTreeNodes(nodes, parentEl, level, siblings) {
            const sortedNodes = [...nodes]; // nodes已按sort_order排序
            sortedNodes.forEach((node, index) => {
              const li = document.createElement('li');
              li.className = 'category-sidebar-item' + (selectedCategory === node.path ? ' active' : '');
              li.setAttribute('data-category', node.path);
              li.setAttribute('data-cat-id', node.id);
              li.setAttribute('data-level', level);
              li.style.paddingLeft = (8 + level * 16) + 'px';

              const hasChildren = node.children && node.children.length > 0;
              const isExpanded = expandedCategories.has(node.id);
              const isFirst = index === 0;
              const isLast = index === sortedNodes.length - 1;

              const toggle = document.createElement('span');
              toggle.className = 'cat-toggle' + (isExpanded ? ' expanded' : '');
              toggle.innerHTML = hasChildren ? '&#x25B6;' : '';
              if (!hasChildren) toggle.style.visibility = 'hidden';
              toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!hasChildren) return;
                if (expandedCategories.has(node.id)) {
                  expandedCategories.delete(node.id);
                } else {
                  expandedCategories.add(node.id);
                }
                renderCategorySidebar();
              });

              const label = document.createElement('span');
              label.className = 'cat-label';
              label.textContent = node.name;

              const count = document.createElement('span');
              count.className = 'cat-count';
              count.textContent = node.site_count || 0;

              // 排序操作按钮（hover时显示）
              const sortActions = document.createElement('span');
              sortActions.className = 'cat-sort-actions';
              
              const upBtn = document.createElement('button');
              upBtn.className = 'cat-sort-btn' + (isFirst ? ' disabled' : '');
              upBtn.title = isFirst ? '已是第一个' : '上移';
              upBtn.innerHTML = '&#x25B2;';
              if (!isFirst) {
                upBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  moveCategory(node.id, 'up');
                });
              }

              const downBtn = document.createElement('button');
              downBtn.className = 'cat-sort-btn' + (isLast ? ' disabled' : '');
              downBtn.title = isLast ? '已是最后一个' : '下移';
              downBtn.innerHTML = '&#x25BC;';
              if (!isLast) {
                downBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  moveCategory(node.id, 'down');
                });
              }

              sortActions.appendChild(upBtn);
              sortActions.appendChild(downBtn);

              li.appendChild(toggle);
              li.appendChild(label);
              li.appendChild(count);
              li.appendChild(sortActions);

              li.addEventListener('click', (e) => {
                if (e.target.closest('.cat-toggle') || e.target.closest('.cat-sort-actions')) return;
                selectCategory(node.path);
              });

              parentEl.appendChild(li);

              // 渲染子分类
              if (hasChildren) {
                const childUl = document.createElement('ul');
                childUl.className = 'category-sidebar-children' + (isExpanded ? '' : ' collapsed');
                renderTreeNodes(node.children, childUl, level + 1, node.children);
                parentEl.appendChild(childUl);
              }
            });
          }

          function moveCategory(catId, direction) {
            fetch('/api/categories/' + catId + '/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ direction: direction })
            }).then(r => r.json()).then(res => {
              if (res.code === 200) {
                loadCategorySidebar();
              } else {
                showMessage(res.message || '移动失败', 'error');
              }
            }).catch(() => showMessage('网络错误', 'error'));
          }

          // 级联分类选择器：从全局 categoryTree 渲染多级下拉，产出 "/" 分隔的路径
          function closeAllSelects() {
            document.querySelectorAll('.cs-select.open').forEach(function(el) {
              el.classList.remove('open');
            });
          }
          document.addEventListener('click', function(e) {
            document.querySelectorAll('.cs-select.open').forEach(function(el) {
              if (!el.contains(e.target)) el.classList.remove('open');
            });
          });

          function makeSelect(opts) {
            const root = document.createElement('div');
            root.className = 'cs-select' + (opts.dashed ? ' cs-select-dashed' : '');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cs-trigger';
            const label = document.createElement('span');
            label.className = 'cs-trigger-label';
            label.textContent = opts.current || opts.placeholder || '';
            btn.appendChild(label);
            btn.insertAdjacentHTML('beforeend', '<svg class="cs-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
            const menu = document.createElement('div');
            menu.className = 'cs-menu';
            (opts.items || []).forEach(function(it) {
              const item = document.createElement('button');
              item.type = 'button';
              item.className = 'cs-option' + (it.value === opts.current ? ' is-selected' : '');
              const name = document.createElement('span');
              name.className = 'cs-option-name';
              name.textContent = it.label;
              item.appendChild(name);
              if (typeof it.count === 'number' && it.count > 0) {
                const cnt = document.createElement('span');
                cnt.className = 'cs-option-count';
                cnt.textContent = it.count;
                item.appendChild(cnt);
              }
              item.addEventListener('click', function() {
                closeAllSelects();
                opts.onPick(it.value);
              });
              menu.appendChild(item);
            });
            if (opts.newLabel) {
              const nb = document.createElement('button');
              nb.type = 'button';
              nb.className = 'cs-option cs-option-action';
              nb.textContent = opts.newLabel;
              nb.addEventListener('click', function() {
                closeAllSelects();
                opts.onNew();
              });
              menu.appendChild(nb);
            }
            btn.addEventListener('click', function() {
              const wasOpen = root.classList.contains('open');
              closeAllSelects();
              if (!wasOpen) root.classList.add('open');
            });
            root.appendChild(btn);
            root.appendChild(menu);
            return root;
          }

          function createCascader(container, hiddenInput, initialPath) {
            if (!container) return null;
            const state = {
              chosen: [],          // { name, isNew, node }
              pickerMode: 'select',// 'select' | 'input'
              pickerInput: ''
            };

            function findNode(children, name) {
              return (children || []).find(function(c){ return c.name === name; }) || null;
            }
            function parentChildren() {
              if (state.chosen.length === 0) return categoryTree || [];
              const last = state.chosen[state.chosen.length - 1];
              return (last && last.node && last.node.children) ? last.node.children : [];
            }
            function siblingsAt(idx) {
              if (idx === 0) return categoryTree || [];
              const parent = state.chosen[idx - 1];
              return (parent && parent.node && parent.node.children) ? parent.node.children : [];
            }
            function path() {
              return state.chosen.map(function(c){ return c.name; }).filter(Boolean).join('/');
            }
            function sync() {
              if (hiddenInput) hiddenInput.value = path();
              const v = container.querySelector('.cascader-path-value');
              if (v) v.textContent = effectivePath() || '未选择';
            }
            // 实际归类路径：未选任何分类→"默认"；停在【有子分类】的某级→追加"/默认"；停在叶子级→不加
            function effectivePath() {
              const p = path();
              if (!p) return '默认';
              const last = state.chosen[state.chosen.length - 1];
              const hasChildren = last && last.node && last.node.children && last.node.children.length > 0;
              return hasChildren ? p + '/默认' : p;
            }

            function initFromPath(p) {
              state.chosen = [];
              state.pickerMode = 'select';
              state.pickerInput = '';
              if (!p) { render(); sync(); return; }
              const parts = String(p).split('/').map(function(s){ return s.trim(); }).filter(Boolean);
              let cursor = categoryTree || [];
              for (const part of parts) {
                const node = findNode(cursor, part);
                state.chosen.push({ name: part, isNew: !node, node: node || null });
                cursor = node ? node.children : [];
              }
              render(); sync();
            }

            function render() {
              container.innerHTML = '';
              const wrap = document.createElement('div');
              wrap.className = 'cascader-wrap';

              state.chosen.forEach(function(lvl, idx) {
                if (idx > 0) {
                  const sep = document.createElement('span');
                  sep.className = 'cascader-sep'; sep.textContent = '/';
                  wrap.appendChild(sep);
                }
                const sel = makeSelect({
                  current: lvl.name,
                  items: siblingsAt(idx).map(function(s) {
                    return { value: s.name, label: s.name };
                  }),
                  newLabel: '新建分类…',
                  onPick: function(v) {
                    const sibs = siblingsAt(idx);
                    const node = findNode(sibs, v);
                    state.chosen = state.chosen.slice(0, idx);
                    state.chosen.push({ name: v, isNew: false, node: node });
                    state.pickerMode = 'select';
                    render(); sync();
                  },
                  onNew: function() {
                    state.chosen = state.chosen.slice(0, idx);
                    state.pickerMode = 'input'; state.pickerInput = '';
                    render();
                    const inp = container.querySelector('.cascader-input');
                    if (inp) inp.focus();
                  }
                });
                wrap.appendChild(sel);

                const rm = document.createElement('span');
                rm.className = 'cascader-remove'; rm.textContent = '×'; rm.title = '删除该级及更深';
                rm.addEventListener('click', function() {
                  state.chosen = state.chosen.slice(0, idx);
                  state.pickerMode = 'select';
                  render(); sync();
                });
                wrap.appendChild(rm);
              });

              if (state.pickerMode === 'select') {
                const picker = makeSelect({
                  dashed: true,
                  placeholder: state.chosen.length === 0 ? '选择一级分类…' : '选择子分类…',
                  items: parentChildren().map(function(c) {
                    return { value: c.name, label: c.name, count: c.site_count };
                  }),
                  newLabel: '＋ 新建分类…',
                  onPick: function(v) {
                    const children = parentChildren();
                    const node = findNode(children, v);
                    state.chosen.push({ name: v, isNew: false, node: node });
                    render(); sync();
                  },
                  onNew: function() {
                    state.pickerMode = 'input'; state.pickerInput = '';
                    render();
                    const inp = container.querySelector('.cascader-input');
                    if (inp) inp.focus();
                  }
                });
                wrap.appendChild(picker);
              } else {
                const inp = document.createElement('input');
                inp.type = 'text'; inp.className = 'cascader-input';
                inp.placeholder = '输入新分类名…'; inp.value = state.pickerInput;
                inp.addEventListener('input', function() { state.pickerInput = inp.value; });
                inp.addEventListener('keydown', function(e) {
                  if (e.key === 'Enter') { e.preventDefault(); confirmNew(); }
                  else if (e.key === 'Escape') { state.pickerMode = 'select'; state.pickerInput = ''; render(); }
                });
                function confirmNew() {
                  const name = (state.pickerInput || '').trim();
                  if (!name) return;
                  state.chosen.push({ name: name, isNew: true, node: null });
                  state.pickerMode = 'select'; state.pickerInput = '';
                  render(); sync();
                  const next = container.querySelector('.cs-trigger') || container.querySelector('.cascader-input');
                  if (next) next.focus();
                }
                const ok = document.createElement('button');
                ok.type = 'button'; ok.className = 'cascader-ok'; ok.textContent = '✓ 确定'; ok.title = '确认新建';
                ok.addEventListener('click', confirmNew);
                wrap.appendChild(inp);
                wrap.appendChild(ok);
              }
              container.appendChild(wrap);

              const prev = document.createElement('div');
              prev.className = 'cascader-path';
              const val = document.createElement('span'); val.className = 'cascader-path-value'; val.textContent = path() || '未选择';
              prev.appendChild(val);
              container.appendChild(prev);
            }

            function refresh() {
              let cursor = categoryTree || [];
              for (const lvl of state.chosen) {
                if (lvl.isNew) { cursor = []; continue; }
                const node = findNode(cursor, lvl.name);
                lvl.node = node || null;
                cursor = node ? node.children : [];
              }
              render(); sync();
            }

            initFromPath(initialPath);
            return { setPath: initFromPath, refresh: refresh, getPath: path, getEffectivePath: effectivePath };
          }

          // 分类数据刷新后同步级联选择器
          let addCatelogCascader = null;
          let editCatelogCascader = null;
          function updateCatelogDatalist() {
            if (addCatelogCascader) addCatelogCascader.refresh();
            if (editCatelogCascader) editCatelogCascader.refresh();
            if (batchCatelogCascader) batchCatelogCascader.refresh();
          }

          function selectCategory(category) {
            selectedCategory = category;
            selectedIds.clear();
            renderCategorySidebar();
            currentPage = 1;
            fetchConfigs(1, currentSearchKeyword);
          }

          if (toggleCategorySidebarBtn) {
            toggleCategorySidebarBtn.addEventListener('click', () => {
              const aside = toggleCategorySidebarBtn.closest('.category-sidebar');
              if (!aside) return;
              const collapsed = aside.classList.toggle('collapsed');
              toggleCategorySidebarBtn.innerHTML = collapsed ? '&#x203A;' : '&#x2039;';
              toggleCategorySidebarBtn.title = collapsed ? '展开分类' : '收起分类';
            });
          }

          // 书签列表：分类过滤 + 关键词搜索
          function fetchConfigs(page = currentPage, keyword = currentSearchKeyword) {
            let url = '/api/config?page=' + page + '&pageSize=' + pageSize;
            if (selectedCategory) {
              url += '&catalog=' + encodeURIComponent(selectedCategory);
            }
            if (keyword) {
              url += '&keyword=' + encodeURIComponent(keyword);
            }
            fetch(url, { cache: 'no-store' })
              .then(res => {
                if (res.status === 401) {
                  window.location.href = '/admin';
                  return null;
                }
                return res.json();
              })
              .then(data => {
                if (!data) return;
                if (data.code === 200) {
                  totalItems = data.total;
                  currentPage = data.page;
                  totalPagesSpan.innerText = Math.max(1, Math.ceil(totalItems / pageSize));
                  currentPageSpan.innerText = currentPage;
                  allConfigs = data.data;
                  renderConfig(allConfigs);
                  updatePaginationButtons();
                } else {
                  showMessage(data.message, 'error');
                }
              }).catch(() => {
                showMessage('网络错误', 'error');
              });
          }

          
          // 添加搜索框
          const searchInput = document.createElement('input');
          searchInput.type = 'text';
          searchInput.placeholder = '搜索书签(名称，网址，分类，描述)';
          searchInput.id = 'searchInput';
          searchInput.className = 'search-input';
          searchInput.style.marginBottom = '12px';
          const configMain = document.querySelector('.config-main');
          if (configMain) {
            const anchor = configMain.querySelector('.batch-bar') || configMain.querySelector('.table-wrapper');
            if (anchor) {
              configMain.insertBefore(searchInput, anchor);
            } else {
              configMain.appendChild(searchInput);
            }
          }
          
          
          let currentPage = 1;
          let pageSize = 10;
          let totalItems = 0;
          let allConfigs = []; // 保存所有配置数据
          let currentSearchKeyword = ''; // 保存当前搜索关键词

          // 批量操作：选中集合跨页保留，元素均为字符串形式的 id
          const selectedIds = new Set();
          const batchBar = document.getElementById('batchBar');
          const batchCount = document.getElementById('batchCount');
          const batchPickAll = document.getElementById('batchPickAll');
          const selectAllPage = document.getElementById('selectAllPage');
          const batchMoveModal = document.getElementById('batchMoveModal');
          const batchMoveTitle = document.getElementById('batchMoveTitle');
          const batchDeleteModal = document.getElementById('batchDeleteModal');
          const batchDeleteTitle = document.getElementById('batchDeleteTitle');
          let batchCatelogCascader = null;
          
          // 创建编辑模态框
          const editModal = document.createElement('div');
          editModal.className = 'modal';
          editModal.style.display = 'none';
          editModal.innerHTML = \`
            <div class="modal-content">
              <span class="modal-close">×</span>
              <h2>编辑站点</h2>
              <form id="editForm">
                <input type="hidden" id="editId">
                <label for="editName">名称:</label>
                <input type="text" id="editName" required><br>
                <label for="editUrl">URL:</label>
                <input type="text" id="editUrl" required><br>
                <label for="editLogo">Logo(可选):</label>
                <input type="text" id="editLogo"><br>
                <label for="editDesc">描述(可选):</label>
                <input type="text" id="editDesc"><br>
                <label for="editCatelog">分类:</label>
                <input type="hidden" id="editCatelog">
                <div id="editCatelogCascader" class="cascader-host"></div><br>
			    <label for="editSortOrder">排序:</label> <!-- [新增] -->
                <input type="number" id="editSortOrder"><br> <!-- [新增] -->
                <button type="submit">保存</button>
              </form>
            </div>
          \`;
          document.body.appendChild(editModal);
          
          const modalClose = editModal.querySelector('.modal-close');
          modalClose.addEventListener('click', () => {
            editModal.style.display = 'none';
          });
          
          const editForm = document.getElementById('editForm');
          editForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const id = document.getElementById('editId').value;
            const name = document.getElementById('editName').value;
            const url = document.getElementById('editUrl').value;
            const logo = document.getElementById('editLogo').value;
            const desc = document.getElementById('editDesc').value;
            // 实际归类：未选→默认；停在有子分类的某级→当前级/默认
            const editCatelogEl = document.getElementById('editCatelog');
            const catelog = editCatelogCascader ? editCatelogCascader.getEffectivePath() : ((editCatelogEl.value || '').trim() || '默认');
                const sort_order = document.getElementById('editSortOrder').value; // [新增]
            const payload = {
                name: name.trim(),
                url: url.trim(),
                logo: logo.trim(),
                desc: desc.trim(),
                catelog: catelog.trim()
            };
            if (sort_order !== '') {
                payload.sort_order = Number(sort_order);
            }
            fetch(\`/api/config/\${id}\`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            }).then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  showMessage('修改成功', 'success');
                  fetchConfigs();
                  loadCategorySidebar();
                  editModal.style.display = 'none'; // 关闭弹窗
                } else {
                  showMessage(data.message, 'error');
                }
              }).catch(err => {
                showMessage('网络错误', 'error');
              })
          });
          
          
          function renderConfig(configs) {
          configTableBody.innerHTML = '';
           if (configs.length === 0) {
                configTableBody.innerHTML = '<tr><td colspan="8">没有配置数据</td></tr>';
                updateBatchBar();
                return
            }
          configs.forEach((config, index) => {
              const row = document.createElement('tr');
              const safeName = escapeHTML(config.name || '');
              const normalizedUrl = normalizeUrl(config.url);
              const displayUrl = config.url ? escapeHTML(config.url) : '未提供';
              const urlCell = normalizedUrl
                ? \`<a href="\${escapeHTML(normalizedUrl)}" target="_blank" rel="noopener noreferrer">\${escapeHTML(normalizedUrl)}</a>\`
                : displayUrl;
              const normalizedLogo = normalizeUrl(config.logo);
              let logoCell;
              const initial = safeName.charAt(0).toUpperCase() || '?';
              if (normalizedLogo) {
                logoCell = \`<img src="\${escapeHTML(normalizedLogo)}" alt="\${safeName}" style="width:30px; display: block;" onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML = '\${initial}';" />\`;
              } else if (normalizedUrl) {
                try {
                  const url = new URL(normalizedUrl);
                  const domain = url.hostname;
                  const iconUrl = faviconApi.replace('{domain}', domain);
                  logoCell = \`<img src="\${escapeHTML(iconUrl)}" alt="\${safeName}" style="width:30px; display: block;" onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML = '\${initial}';" />\`;
                } catch (error) {
                  logoCell = initial;
                }
              } else {
                logoCell = initial;
              }
              const descCell = config.desc ? escapeHTML(config.desc) : 'N/A';
              const catelogCell = escapeHTML(config.catelog || '');
              const sortValue = config.sort_order || 9999;
               row.innerHTML = \`
                  <td class="col-select"><input type="checkbox" class="row-check" data-id="\${config.id}"></td>
                  <td><div class="cell">\${safeName}</div></td>
                  <td><div class="cell">\${urlCell}</div></td>
                  <td><div class="cell">\${logoCell}</div></td>
                  <td><div class="cell">\${descCell}</div></td>
                  <td><div class="cell">\${catelogCell}</div></td>
				 <td><div class="cell">\${sortValue}</div></td>
                  <td class="actions">
                    <button class="edit-btn" data-id="\${config.id}">编辑</button>
                    <button class="del-btn" data-id="\${config.id}">删除</button>
                  </td>
               \`;
              configTableBody.appendChild(row);
              if (selectedIds.has(String(config.id))) {
                const cb = row.querySelector('.row-check');
                if (cb) cb.checked = true;
                row.classList.add('selected');
              }
          });
            bindActionEvents();
            updateBatchBar();
          }
          
          // 事件委托：仅在首次渲染时绑定一次，后续重渲染无需重复绑定
          function bindActionEvents() {
            if (configTableBody.__actionDelegated) return;
            configTableBody.__actionDelegated = true;
            configTableBody.addEventListener('click', function(e) {
              const editBtn = e.target.closest('.edit-btn');
              if (editBtn) { handleEdit(editBtn.dataset.id); return; }
              const delBtn = e.target.closest('.del-btn');
              if (delBtn) { handleDelete(delBtn.dataset.id); return; }
            });
            configTableBody.addEventListener('change', function(e) {
              const cb = e.target.closest('.row-check');
              if (!cb) return;
              const id = String(cb.dataset.id);
              if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
              const tr = cb.closest('tr');
              if (tr) tr.classList.toggle('selected', cb.checked);
              updateBatchBar();
            });
         }

          // 批量条：有选中项时出现，并同步表头复选框状态
          function updateBatchBar() {
            const count = selectedIds.size;
            if (batchBar) batchBar.classList.toggle('visible', count > 0);
            if (batchCount) batchCount.textContent = '已选 ' + count + ' 项';
            const pageIds = (allConfigs || []).map(c => String(c.id));
            const picked = pageIds.filter(id => selectedIds.has(id)).length;
            if (selectAllPage) {
              selectAllPage.checked = pageIds.length > 0 && picked === pageIds.length;
              selectAllPage.indeterminate = picked > 0 && picked < pageIds.length;
            }
            if (batchPickAll) {
              const allPicked = totalItems > 0 && count >= totalItems;
              const pickText = document.getElementById('batchPickAllText');
              const iconAll = document.getElementById('batchPickIconAll');
              const iconClear = document.getElementById('batchPickIconClear');
              if (pickText) pickText.textContent = allPicked ? '取消全选' : '全选';
              if (iconAll) iconAll.style.display = allPicked ? 'none' : '';
              if (iconClear) iconClear.style.display = allPicked ? '' : 'none';
            }
            if (batchMoveTitle) batchMoveTitle.textContent = '迁移 ' + count + ' 个网站到';
            if (batchDeleteTitle) batchDeleteTitle.textContent = '删除 ' + count + ' 个网站？';
          }

          if (selectAllPage) {
            selectAllPage.addEventListener('change', function() {
              const pageIds = (allConfigs || []).map(c => String(c.id));
              if (selectAllPage.checked) pageIds.forEach(id => selectedIds.add(id));
              else pageIds.forEach(id => selectedIds.delete(id));
              renderConfig(allConfigs);
            });
          }

          if (batchPickAll) {
            batchPickAll.addEventListener('click', function() {
              if (totalItems > 0 && selectedIds.size >= totalItems) {
                selectedIds.clear();
                renderConfig(allConfigs);
                return;
              }
              const qs = [];
              if (selectedCategory) qs.push('catalog=' + encodeURIComponent(selectedCategory));
              if (currentSearchKeyword) qs.push('keyword=' + encodeURIComponent(currentSearchKeyword));
              fetch('/api/config/ids' + (qs.length ? '?' + qs.join('&') : ''))
                .then(res => res.json())
                .then(data => {
                  if (data.code !== 200) { showMessage(data.message || '读取失败', 'error'); return; }
                  const ids = data.data || [];
                  if (ids.length > 1000) { showMessage('单次最多处理 1000 条，当前结果过多', 'error'); return; }
                  ids.forEach(id => selectedIds.add(String(id)));
                  renderConfig(allConfigs);
                }).catch(() => showMessage('网络错误', 'error'));
            });
          }

          const batchMoveBtn = document.getElementById('batchMoveBtn');
          const batchMoveClose = document.getElementById('batchMoveClose');
          const batchMoveCancel = document.getElementById('batchMoveCancel');
          const batchMoveConfirm = document.getElementById('batchMoveConfirm');
          if (batchMoveBtn) {
            batchMoveBtn.addEventListener('click', function() {
              if (selectedIds.size === 0) return;
              updateBatchBar();
              batchMoveModal.style.display = 'block';
              if (batchCatelogCascader) batchCatelogCascader.setPath('');
            });
          }
          [batchMoveClose, batchMoveCancel].forEach(function(btn) {
            if (btn) btn.addEventListener('click', function () { batchMoveModal.style.display = 'none'; });
          });
          if (batchMoveConfirm) {
            batchMoveConfirm.addEventListener('click', function() {
              const target = batchCatelogCascader ? String(batchCatelogCascader.getEffectivePath() || '').trim() : '';
              if (!target) { showMessage('请选择目标分类', 'error'); return; }
              issueBatch('move', target);
            });
          }

          const batchDeleteBtn = document.getElementById('batchDeleteBtn');
          const batchDeleteCancel = document.getElementById('batchDeleteCancel');
          const batchDeleteConfirm = document.getElementById('batchDeleteConfirm');
          if (batchDeleteBtn) {
            batchDeleteBtn.addEventListener('click', function() {
              if (selectedIds.size === 0) return;
              updateBatchBar();
              batchDeleteModal.style.display = 'block';
            });
          }
          if (batchDeleteCancel) {
            batchDeleteCancel.addEventListener('click', function () { batchDeleteModal.style.display = 'none'; });
          }
          if (batchDeleteConfirm) {
            batchDeleteConfirm.addEventListener('click', function () { issueBatch('delete'); });
          }

          const batchReorderBtn = document.getElementById('batchReorderBtn');
          if (batchReorderBtn) {
            batchReorderBtn.addEventListener('click', function() {
              if (selectedIds.size === 0) return;
              const ids = Array.from(selectedIds);
              batchReorderBtn.disabled = true;
              fetch('/api/config/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reorder', ids: ids })
              }).then(res => res.json())
                .then(data => {
                  if (data.code !== 200) {
                    showMessage(data.message || '操作失败', 'error');
                    return;
                  }
                  showMessage('已重新排序 ' + ids.length + ' 个网站', 'success');
                  selectedIds.clear();
                  fetchConfigs(currentPage, currentSearchKeyword);
                }).catch(() => showMessage('网络错误', 'error'))
                .finally(function () { batchReorderBtn.disabled = false; });
            });
          }

          const batchExportBtn = document.getElementById('batchExportBtn');
          if (batchExportBtn) {
            batchExportBtn.addEventListener('click', function() {
              const ids = Array.from(selectedIds);
              if (ids.length === 0) return;
              fetch('/api/config/export?ids=' + encodeURIComponent(ids.join(',')))
                .then(res => res.blob())
                .then(blob => {
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'config-selected.json';
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                }).catch(() => showMessage('网络错误', 'error'));
            });
          }

          // 执行批量迁移或删除
          function issueBatch(action, catelog) {
            if (selectedIds.size === 0) return;
            const ids = Array.from(selectedIds);
            if (batchMoveConfirm) batchMoveConfirm.disabled = true;
            if (batchDeleteConfirm) batchDeleteConfirm.disabled = true;
            fetch('/api/config/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: action, ids: ids, catelog: catelog || '' })
            }).then(res => res.json())
              .then(data => {
                if (data.code !== 200) {
                  showMessage(data.message || '操作失败', 'error');
                  return;
                }
                const done = (data.data && typeof data.data.affected === 'number' && data.data.affected > 0)
                  ? data.data.affected : ids.length;
                showMessage(action === 'move' ? '已迁移 ' + done + ' 个网站' : '已删除 ' + done + ' 个网站', 'success');
                selectedIds.clear();
                batchMoveModal.style.display = 'none';
                batchDeleteModal.style.display = 'none';
                let targetPage = currentPage;
                if (action === 'delete') {
                  const remain = Math.max(totalItems - done, 0);
                  targetPage = Math.min(currentPage, Math.max(1, Math.ceil(remain / pageSize)));
                }
                fetchConfigs(targetPage, currentSearchKeyword);
                loadCategorySidebar();
                if (action === 'move') updateCatelogDatalist();
              }).catch(() => showMessage('网络错误', 'error'))
              .finally(function () {
                if (batchMoveConfirm) batchMoveConfirm.disabled = false;
                if (batchDeleteConfirm) batchDeleteConfirm.disabled = false;
              });
          }

    // 点击编辑：直接用当前页已加载的 allConfigs 取目标数据，无需再请求
          function handleEdit(id) {
            const configToEdit = allConfigs.find(c => c.id == id);
            if (!configToEdit) {
                showMessage('找不到要编辑的数据', 'error');
                return;
            }
            document.getElementById('editId').value = configToEdit.id;
            document.getElementById('editName').value = configToEdit.name;
            document.getElementById('editUrl').value = configToEdit.url;
            document.getElementById('editLogo').value = configToEdit.logo || '';
            document.getElementById('editDesc').value = configToEdit.desc || '';
            document.getElementById('editCatelog').value = configToEdit.catelog;
            if (editCatelogCascader) {
              // 回填：存的就是实际归到的路径；唯有未选分类存的"默认"回填为空
              let sel = (configToEdit.catelog || '').trim();
              if (sel === '默认') sel = '';
              editCatelogCascader.setPath(sel);
            }
            document.getElementById('editSortOrder').value = configToEdit.sort_order === 9999 ? '' : configToEdit.sort_order;
            editModal.style.display = 'block';
          }
          function handleDelete(id) {
            if(!confirm('确认删除？')) return;
             fetch(\`/api/config/\${id}\`, {
                  method: 'DELETE'
              }).then(res => res.json())
                 .then(data => {
                     if (data.code === 200) {
                         showMessage('删除成功', 'success');
                         fetchConfigs();
                         loadCategorySidebar();
                     } else {
                         showMessage(data.message, 'error');
                     }
                 }).catch(err => {
                      showMessage('网络错误', 'error');
                 })
          }
          function showMessage(message, type) {
            messageDiv.innerText = message;
            messageDiv.className = type;
            messageDiv.style.display = 'block';
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 3000);
          }
          
          function updatePaginationButtons() {
            prevPageBtn.disabled = currentPage === 1;
             nextPageBtn.disabled = currentPage >= Math.ceil(totalItems/pageSize)
          }
          
          prevPageBtn.addEventListener('click', () => {
          if(currentPage > 1) {
              fetchConfigs(currentPage -1);
          }
          });
          nextPageBtn.addEventListener('click', () => {
            if (currentPage < Math.ceil(totalItems/pageSize)) {
              fetchConfigs(currentPage + 1);
            }
          });

          // 打开添加弹窗
          function openAddModal() {
            addName.value = '';
            addUrl.value = '';
            addLogo.value = '';
            addDesc.value = '';
            addCatelog.value = '';
            addSortOrder.value = '';
            if (addCatelogCascader) addCatelogCascader.setPath('');
            addModal.style.display = 'block';
            requestAnimationFrame(() => addName.focus());
          }
          function closeAddModal() {
            addModal.style.display = 'none';
          }
          addBtn.addEventListener('click', openAddModal);
          if (addModalClose) addModalClose.addEventListener('click', closeAddModal);
          // 点击遮罩关闭
          if (addModal) {
            addModal.addEventListener('click', function(e) {
              if (e.target === addModal) closeAddModal();
            });
          }
          // 提交添加（表单 submit）
          if (addForm) {
            addForm.addEventListener('submit', function(e) {
              e.preventDefault();
              submitAddBookmark();
            });
          }

          // 提交添加
          function submitAddBookmark() {
            const name = addName.value;
            const url = addUrl.value;
            const logo = addLogo.value;
            const desc = addDesc.value;
            // 实际归类：未选→默认；停在有子分类的某级→当前级/默认
            const catelog = addCatelogCascader ? addCatelogCascader.getEffectivePath() : ((addCatelog.value || '').trim() || '默认');
            const sort_order = addSortOrder.value;
            if(!name || !url) {
              showMessage('名称,网址 必填', 'error');
              return;
            }
            const payload = {
              name: name.trim(),
              url: url.trim(),
              logo: logo.trim(),
              desc: desc.trim(),
              catelog: catelog.trim()
            };
            if (sort_order !== '') {
              payload.sort_order = Number(sort_order);
            }
            fetch('/api/config', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            }).then(res => res.json())
            .then(data => {
              if(data.code === 201) {
                showMessage('添加成功', 'success');
                closeAddModal();
                fetchConfigs();
                loadCategorySidebar();
              } else {
                showMessage(data.message, 'error');
              }
            }).catch(err => {
              showMessage('网络错误', 'error');
            })
          }
          
          importBtn.addEventListener('click', () => {
          importFile.click();
          });
          importFile.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
           const reader = new FileReader();
          reader.onload = function(event) {
             try {
                 const jsonData = JSON.parse(event.target.result);
                   fetch('/api/config/import', {
                       method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                       body: JSON.stringify(jsonData)
                  }).then(res => res.json())
                     .then(data => {
                          if(data.code === 201) {
                             showMessage('导入成功', 'success');
                              fetchConfigs();
                              loadCategorySidebar();
                          } else {
                             showMessage(data.message, 'error');
                          }
                     }).catch(err => {
                           showMessage('网络错误', 'error');
                  })
          
             } catch (error) {
                   showMessage('JSON格式不正确', 'error');
             }
          }
           reader.readAsText(file);
          }
          })
          exportBtn.addEventListener('click', () => {
          fetch('/api/config/export')
          .then(res => res.blob())
          .then(blob => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'config.json';
          document.body.appendChild(a);
          a.click();
           window.URL.revokeObjectURL(url);
           document.body.removeChild(a);
          }).catch(err => {
          showMessage('网络错误', 'error');
          })
          })
          
          // 搜索功能
          searchInput.addEventListener('input', () => {
              currentSearchKeyword = searchInput.value.trim();
              currentPage = 1; // 搜索时重置为第一页
              selectedIds.clear();
              fetchConfigs(currentPage,currentSearchKeyword);
          });


          // 初始化级联分类选择器
          addCatelogCascader = createCascader(
            document.getElementById('addCatelogCascader'),
            document.getElementById('addCatelog'),
            ''
          );
          editCatelogCascader = createCascader(
            document.getElementById('editCatelogCascader'),
            document.getElementById('editCatelog'),
            ''
          );
          batchCatelogCascader = createCascader(
            document.getElementById('batchCatelogCascader'),
            document.getElementById('batchCatelog'),
            ''
          );

          fetchConfigs();
          loadCategorySidebar();
          
          // 退出登录功能
          const logoutBtn = document.getElementById('logoutBtn');
          const logoutModal = document.getElementById('logoutModal');
          const logoutCancel = document.getElementById('logoutCancel');
          const logoutConfirm = document.getElementById('logoutConfirm');

          function doLogout() {
            fetch('/api/logout', {
              method: 'POST'
            }).then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  showMessage('已成功退出登录', 'success');
                  setTimeout(() => {
                    window.location.href = '/admin';
                  }, 1000);
                } else {
                  showMessage(data.message || '退出失败', 'error');
                }
              }).catch(err => {
                showMessage('网络错误', 'error');
              });
          }

          if (logoutBtn && logoutModal) {
            logoutBtn.addEventListener('click', () => {
              logoutModal.style.display = 'block';
            });
            logoutCancel.addEventListener('click', () => {
              logoutModal.style.display = 'none';
            });
            logoutConfirm.addEventListener('click', () => {
              logoutModal.style.display = 'none';
              doLogout();
            });
          }

          // 站点设置：账号密码、图标 API、站点名称
          const settingsBtn = document.getElementById('settingsBtn');
          const settingsModal = document.getElementById('settingsModal');
          const settingsModalClose = document.getElementById('settingsModalClose');
          const settingsForm = document.getElementById('settingsForm');

          function openSettings() {
            document.getElementById('setNewPass').value = '';
            document.getElementById('settingsError').style.display = 'none';
            settingsModal.style.display = 'block';
          }

          if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
          if (settingsModalClose) {
            settingsModalClose.addEventListener('click', function () {
              settingsModal.style.display = 'none';
            });
          }
          if (settingsForm) {
            settingsForm.addEventListener('submit', function (e) {
              e.preventDefault();
              var errorBox = document.getElementById('settingsError');
              errorBox.style.display = 'none';
              function fail(msg) {
                errorBox.textContent = msg;
                errorBox.style.display = 'block';
              }
              var payload = {
                site_title: document.getElementById('setTitle').value,
                site_subtitle: document.getElementById('setSubtitle').value,
                favicon_api: document.getElementById('setFavicon').value,
                admin_user: document.getElementById('setUser').value
              };
              var newPass = document.getElementById('setNewPass').value.trim();
              if (newPass) {
                payload.admin_pass = newPass;
              }
              fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              }).then(res => res.json())
                .then(data => {
                  if (data.code === 200) {
                    showMessage('设置已保存', 'success');
                    settingsModal.style.display = 'none';
                    setTimeout(function () { window.location.reload(); }, 700);
                  } else {
                    fail(data.message || '保存失败');
                  }
                }).catch(function () { fail('网络错误，请稍后重试'); });
            });
          }
          `
    }
    return fileContents[filePath]
    },
  
    async renderAdminPage(env) {
    const settings = await readSettings(env);
    const faviconApi = getIconApiUrl(env, settings);
    let html = await this.getFileContent('admin.html');
    html = html
      .replace('const faviconApi = \'https://toolb.cn/favicon/{domain}\';', `const faviconApi = ${JSON.stringify(faviconApi)};`)
      .replace('<title>书签管理</title>', `<title>${escapeHTML(settings.site_title || '琪舟阁')} · 书签管理</title>`);
    // 设置面板回填当前配置：按 id 定位输入框，不依赖占位文字
    html = fillInputValue(html, 'setTitle', settings.site_title || '');
    html = fillInputValue(html, 'setSubtitle', settings.site_subtitle || '');
    html = fillInputValue(html, 'setFavicon', faviconApi);
    html = fillInputValue(html, 'setUser', settings.admin_user || 'admin');
    return new Response(html, {
        headers: {'Content-Type': 'text/html; charset=utf-8'}
    });
    },
  
    async renderLoginPage(message = '') {
      const hasError = Boolean(message);
      const safeMessage = hasError ? escapeHTML(message) : '';
      const html = `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>管理员登录</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
          html, body { height: 100%; }
          body { display: flex; align-items: center; justify-content: center; padding: 24px; background: #fdf8f3; color: #111827; font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
          .login { width: 100%; max-width: 380px; padding: 32px 28px; background: #ffffff; border: 1px solid #e6e8ec; border-radius: 10px; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 12px 32px rgba(16, 24, 40, 0.06); }
          .login h1 { font-size: 20px; font-weight: 600; color: #111827; }
          form { margin-top: 24px; }
          .field + .field { margin-top: 16px; }
          label { display: block; margin-bottom: 6px; font-size: 13px; color: #4b5563; }
          input { width: 100%; height: 42px; padding: 0 12px; border: 1px solid #d9dee6; border-radius: 8px; background: #ffffff; color: #111827; font-size: 15px; font-family: inherit; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
          input:hover { border-color: #c3cad6; }
          input:focus { border-color: #31597f; box-shadow: 0 0 0 3px rgba(37, 66, 103, 0.12); }
          .err { margin-top: 14px; font-size: 13px; color: #b42318; }
          button { width: 100%; height: 42px; margin-top: 24px; border: 0; border-radius: 8px; background: #3e6b9b; color: #ffffff; font-family: inherit; font-size: 15px; font-weight: 500; cursor: pointer; transition: background 0.15s ease; }
          button:hover { background: #355d88; }
          .back { display: block; margin-top: 20px; color: #6b7280; font-size: 13px; text-align: center; text-decoration: none; }
          .back:hover { color: #31597f; }
        </style>
      </head>
      <body>
        <main class="login">
          <h1>管理员登录</h1>
          <form method="post" action="/admin" novalidate>
            <div class="field">
              <label for="username">用户名</label>
              <input type="text" id="username" name="name" required autocomplete="username" placeholder="默认 admin">
            </div>
            <div class="field">
              <label for="password">密码</label>
              <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="默认 admin">
            </div>
            <p class="err"${hasError ? '' : ' style="display:none;"'}>${hasError ? safeMessage : '用户名或密码错误'}</p>
            <button type="submit">登录</button>
          </form>
          <a href="/" class="back">返回首页</a>
        </main>
      </body>
      </html>`;
      
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  };
  
  
  /**
   * 优化后的主逻辑：处理请求，返回优化后的 HTML
   */
  async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const catalog = url.searchParams.get('catalog');

    let sites = [];
    let categoryRows = null;
    let siteSettings;
    try {
      const [sitesRes, catRes, settingsRes] = await Promise.all([
        env.NAV_DB.prepare('SELECT id, name, url, logo, "desc", catelog, sort_order FROM sites ORDER BY sort_order ASC, create_time DESC').all(),
        env.NAV_DB.prepare('SELECT id, name, parent_id, path, sort_order FROM categories ORDER BY sort_order ASC, id ASC').all().catch(() => null),
        readSettings(env)
      ]);
      sites = sitesRes.results || [];
      categoryRows = catRes ? (catRes.results || []) : null;
      siteSettings = settingsRes;
    } catch (e) {
      return new Response(`Failed to fetch data: ${e.message}`, { status: 500 });
    }

    const totalSites = sites.length;

    // 先计算每个分类的书签数量
    const siteCountMap = new Map();
    for (const site of sites) {
      const catName = (site.catelog || '').trim();
      if (!catName) continue;
      siteCountMap.set(catName, (siteCountMap.get(catName) || 0) + 1);
    }

    // 从 categories 表获取分类树（查询已在上面并行完成）
    let categoryTree = [];
    let flatCats = [];
    if (categoryRows) {
      // 孤儿分类在写操作中统一清理，读取（首页）不再重复清理以减少每次访问的 DB 开销
      const catsWithCount = categoryRows.map(c => ({
        ...c,
        site_count: siteCountMap.get(c.path) || 0
      }));
      
      categoryTree = buildCategoryTree(catsWithCount, 0);
      // 递归汇总子分类计数到父分类
      rollupCategoryCounts(categoryTree);
      // 剪枝：过滤空分类
      categoryTree = pruneEmptyCategories(categoryTree);
      flatCats = flattenCategoryTree(categoryTree);
    } else {
      // categories表可能不存在，降级为从sites提取
      const categoryMinSort = new Map();
      const categorySet = new Set();
      sites.forEach((site) => {
        const categoryName = (site.catelog || '').trim() || '未分类';
        categorySet.add(categoryName);
        const rawSort = Number(site.sort_order);
        const normalized = Number.isFinite(rawSort) ? rawSort : 9999;
        if (!categoryMinSort.has(categoryName) || normalized < categoryMinSort.get(categoryName)) {
          categoryMinSort.set(categoryName, normalized);
        }
      });
      flatCats = Array.from(categorySet).map(name => ({
        name: name,
        path: name,
        level: 0,
        children: [],
        site_count: siteCountMap.get(name) || 0,
        order: categoryMinSort.get(name) || 9999
      })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      categoryTree = flatCats;
    }

    const catalogs = flatCats.map(c => c.path);
    
    // 根据 URL 参数筛选站点
    const requestedCatalog = (catalog || '').trim();
    const catalogExists = Boolean(requestedCatalog && catalogs.includes(requestedCatalog));
    const currentCatalog = catalogExists ? requestedCatalog : '';
    const currentSites = catalogExists
      ? sites.filter((s) => {
          const catValue = (s.catelog || '').trim();
          // 精确匹配该分类或其子分类
          return catValue === currentCatalog || catValue.startsWith(currentCatalog + '/');
        })
      : sites;
    
    // 构建树形分类导航HTML
    // 判断一个分类路径是否是当前选中路径的祖先（或自身）
    function isAncestorOrSelf(ancestorPath, currentPath) {
      if (!currentPath) return false;
      return currentPath === ancestorPath || currentPath.startsWith(ancestorPath + '/');
    }

    // 分类节点序号：中文路径经过替换后会得到相同的 id，这里按渲染顺序编号保证唯一
    let catNodeSeq = 0;
    function renderFrontendCategoryTree(nodes, level) {
      return nodes.map(node => {
        const safeCat = escapeHTML(node.path);
        const safeName = escapeHTML(node.name);
        // 对路径每段分别编码，保留 / 分隔符
        const encodedCat = node.path.split('/').map(encodeURIComponent).join('/');
        const isActive = catalogExists && node.path === currentCatalog;
        const hasChildren = node.children && node.children.length > 0;
        const shouldExpand = catalogExists && isAncestorOrSelf(node.path, currentCatalog); // 默认折叠，但选中路径的祖先自动展开
        const linkClass = isActive ? 'bg-secondary-100/80 text-primary-700 font-semibold active' : 'hover:bg-gray-100/60';
        const countBadge = (node.site_count > 0) ? `<span class="ml-auto text-xs text-gray-400">${node.site_count}</span>` : '';
        // 根级与"全部"对齐：左padding=12px，每深入一级缩进20px（一个toggle宽度）
        const rowPaddingLeft = 12 + (level * 20);
        const childrenId = 'cat-children-' + (++catNodeSeq);
        
        let html = `
          <div class="cat-row" style="padding-left:${rowPaddingLeft}px">
            ${hasChildren ? `<button class="cat-expand-btn${shouldExpand ? ' expanded' : ''}" data-target="${childrenId}" title="${shouldExpand ? '折叠' : '展开'}"><svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6l4 4-4 4V6z"/></svg></button>` : '<span class="cat-expand-placeholder"></span>'}
            <a href="?catalog=${encodedCat}" class="category-link flex items-center py-2 rounded-lg ${linkClass} flex-1 text-sm" style="padding-left:8px;padding-right:8px">
              <span class="truncate">${safeName}</span>
              ${countBadge}
            </a>
          </div>`;
        if (hasChildren) {
          html += `<div class="cat-children${shouldExpand ? '' : ' collapsed'}" id="${childrenId}">`;
          html += renderFrontendCategoryTree(node.children, level + 1);
          html += `</div>`;
        }
        return html;
      }).join('');
    }
    
    let catalogLinkMarkup = '';
    catalogLinkMarkup += renderFrontendCategoryTree(categoryTree, 0);

    const datalistOptions = catalogs.map((cat) => `<option value="${escapeHTML(cat)}">`).join('');
    const headingPlainText = catalogExists
      ? `${currentCatalog.split('/').pop()} · ${currentSites.length} 个网站`
      : `全部 · ${sites.length} 个网站`;
    const headingText = escapeHTML(headingPlainText);
    const headingDefaultAttr = escapeHTML(headingPlainText);
    const headingActiveAttr = catalogExists ? escapeHTML(currentCatalog) : '';
    const faviconApi = getIconApiUrl(env, siteSettings);

    // 优化后的 HTML
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHTML(siteSettings.site_title)}</title>
      <link rel="icon" href="data:image/webp;base64,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" type="image/webp"/>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                primary: {
                  50: '#f3f5f9',
                  100: '#e1e7f1',
                  200: '#c3d0e3',
                  300: '#9cb3d1',
                  400: '#6c8fba',
                  500: '#4d7cab',
                  600: '#3e6b9b',
                  700: '#31597f',
                  800: '#1d3552',
                  900: '#192e45',
                  950: '#101e2d',
                },
                secondary: {
                  50: '#fdf8f3',
                  100: '#f6ede1',
                  200: '#ead6ba',
                  300: '#dfc19a',
                  400: '#d2aa79',
                  500: '#b88d58',
                  600: '#a17546',
                  700: '#835b36',
                  800: '#6b492c',
                  900: '#5a3e26',
                  950: '#2f1f13',
                },
                accent: {
                  50: '#f2faf6',
                  100: '#d9f0e5',
                  200: '#b4dfcb',
                  300: '#89caa9',
                  400: '#61b48a',
                  500: '#3c976d',
                  600: '#2e7755',
                  700: '#265c44',
                  800: '#204b38',
                  900: '#1b3e30',
                  950: '#0e221b',
                },
              },
              fontFamily: {
                sans: ['Noto Sans SC', 'sans-serif'],
              },
            }
          }
        }
      </script>
      <style>
        /* 全局平滑过渡 */
        * { -webkit-tap-highlight-color: transparent; }
        html { scroll-behavior: smooth; }
        body { background: #fdf8f3 !important; min-height: 100vh; }
        /* 自定义滚动条 */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; border-radius: 10px; }
        ::-webkit-scrollbar-thumb { background: rgba(108, 143, 186, 0.3); border-radius: 10px; transition: background 0.3s; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(65, 109, 157, 0.5); }
        
        /* 毛玻璃侧边栏 */
        .sidebar { background: rgba(255, 255, 255, 0.82) !important; backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); border-right: 1px solid rgba(226, 232, 240, 0.8) !important; box-shadow: 4px 0 24px rgba(37, 66, 103, 0.05); }
        
        /* 毛玻璃浮动按钮 */
        .glass-btn { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.6); box-shadow: 0 4px 16px rgba(37, 66, 103, 0.08); transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); }
        .glass-btn:hover { background: rgba(255, 255, 255, 0.9); box-shadow: 0 6px 20px rgba(37, 66, 103, 0.12); transform: translateY(-1px); }
        
        /* 卡片：背景做实，不再逐张实时模糊，滚动更顺 */
        .site-card { background: rgba(255, 255, 255, 0.92) !important; border: 1px solid rgba(226, 232, 240, 0.9) !important; transition: opacity 0.45s ease, transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.35s ease, border-color 0.35s ease; opacity: 0; transform: translateY(18px); will-change: transform, opacity; }
        /* 进入视口后弹出 */
        .site-card.is-visible { opacity: 1; transform: translateY(0); }
        .site-card.is-visible:hover { transform: translateY(-4px); box-shadow: 0 12px 28px rgba(37, 66, 103, 0.12), 0 2px 6px rgba(37, 66, 103, 0.06); border-color: rgba(195, 208, 227, 0.9) !important; }
        /* Logo 动感 */
        .site-card .logo-container,
        .site-card > div > div:first-child > div { transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .site-card:hover .logo-container,
        .site-card:hover > div > div:first-child > div { transform: scale(1.12) rotate(-4deg); }
        /* 标题轻微右移 + 颜色 */
        .site-card h3 { transition: transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.35s ease; }
        .site-card:hover h3 { transform: translateX(3px); color: rgba(37, 66, 103, 0.95); }
        /* 分类标签微弹 */
        .site-card .inline-flex { transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .site-card:hover .inline-flex { transform: scale(1.06); }
        /* 复制按钮悬停放大 */
        .site-card .copy-btn { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.3s ease, color 0.3s ease; }
        .site-card:hover .copy-btn { transform: scale(1.08); }

        /* 搜索框毛玻璃 */
        .glass-search { background: rgba(255, 255, 255, 0.6) !important; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(225, 231, 241, 0.8) !important; transition: all 0.3s ease; }
        .glass-search:focus { background: rgba(255, 255, 255, 0.9) !important; border-color: rgba(108, 143, 186, 0.5) !important; box-shadow: 0 0 0 3px rgba(108, 143, 186, 0.1); }
        
        /* 分类链接：不靠位移，靠底色和左侧标记 */
        .category-link { transition: background 0.2s ease, color 0.2s ease; position: relative; }
        .category-link:hover { background: rgba(65, 109, 157, 0.06); }
        .category-link.active { background: linear-gradient(135deg, rgba(65, 109, 157, 0.1), rgba(65, 109, 157, 0.05)) !important; }
        .category-link.active::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px; border-radius: 2px; background: #3e6b9b; }
        
        /* 页脚毛玻璃 */
        .glass-footer { background: rgba(255, 255, 255, 0.5) !important; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid rgba(255, 255, 255, 0.5) !important; }
        
        /* 返回顶部按钮 */
        .back-top-btn { background: rgba(77, 124, 171, 0.92) !important; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 4px 20px rgba(16, 24, 40, 0.14); transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); }
        .back-top-btn:hover { background: rgba(53, 93, 136, 0.96) !important; transform: translateY(-2px); box-shadow: 0 6px 24px rgba(16, 24, 40, 0.18); }
        .back-top-btn.visible { opacity: 1 !important; visibility: visible !important; }
        
        /* 移动端遮罩层平滑 */
        .mobile-overlay { transition: opacity 0.3s ease, visibility 0.3s ease; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
        
        /* 预览模态框增强 */
        .preview-modal { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .preview-modal.visible { opacity: 1 !important; visibility: visible !important; }
        
        /* 头部渐变增强 */
        .hero-header { background: linear-gradient(135deg, #4a78a5 0%, #5e8db8 55%, #78a5cc 100%) !important; position: relative; overflow: hidden; }
        .hero-header::before { content: ''; position: absolute; top: -50%; right: -20%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(210, 170, 121, 0.15) 0%, transparent 70%); pointer-events: none; }
        .hero-header::after { content: ''; position: absolute; bottom: -30%; left: -10%; width: 400px; height: 400px; background: radial-gradient(circle, rgba(97, 180, 138, 0.1) 0%, transparent 70%); pointer-events: none; }
        
        /* 毛玻璃统计卡片 */
        .glass-stats { background: rgba(255, 255, 255, 0.14) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.22) !important; box-shadow: 0 6px 20px rgba(16, 24, 40, 0.08); }
        
        /* 复制成功提示 */
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateY(10px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px); }
        }
        .copy-tip { animation: fadeInOut 1.8s ease forwards; }
        .copy-success-animation { animation: fadeInOut 2s ease forwards; }
        
        /* 分类展开/折叠 */
        .cat-row { display: flex; align-items: center; }
        .cat-expand-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 28px; border: none; background: transparent; cursor: pointer; color: #9ca3af; padding: 0; flex-shrink: 0; border-radius: 4px; transition: transform 0.15s, color 0.15s, background 0.15s; }
        .cat-expand-btn:hover { color: #6c63ff; background: rgba(108,99,255,0.08); }
        .cat-expand-btn.expanded { transform: rotate(90deg); }
        .cat-expand-placeholder { display: inline-block; width: 20px; height: 28px; flex-shrink: 0; }
        .cat-children { overflow: hidden; max-height: 5000px; transition: max-height 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.25s ease; opacity: 1; }
        .cat-children.collapsed { max-height: 0; opacity: 0; }
        
        /* 移动端侧边栏 */
        @media (max-width: 768px) {
          .mobile-sidebar { transform: translateX(-100%); transition: transform 0.3s ease; }
          .mobile-sidebar.open { transform: translateX(0); }
          .mobile-overlay { opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
          .mobile-overlay.open { opacity: 1; pointer-events: auto; }
        }
        
        /* 多行文本截断 */
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        
        /* 侧边栏控制 */
        #sidebar-toggle { display: none; }
        
        @media (min-width: 769px) {
          #sidebar-toggle:checked ~ .sidebar { margin-left: -16rem; }
          #sidebar-toggle:checked ~ .main-content { margin-left: 0; }
        }
        
        /* 性能优化样式 */
        .logo-img { will-change: opacity; }
        
        /* 预连接优化 - 减少 DNS 查找延迟 */
        body::before { content: ""; display: none; /* 预连接常用的图标 API（如果有） */ }
      </style>
    </head>
    <body class="bg-secondary-50 font-sans text-gray-800">
      <!-- 侧边栏开关 -->
      <input type="checkbox" id="sidebar-toggle" class="hidden" checked>
      <script>
        (function () {
          var t = document.getElementById('sidebar-toggle');
          try { if (localStorage.getItem('zq_sidebar') === 'open') t.checked = false; } catch (e) {}
          t.addEventListener('change', function () {
            try { localStorage.setItem('zq_sidebar', t.checked ? 'closed' : 'open'); } catch (e) {}
          });
        })();
      </script>
      
      <!-- 移动端导航按钮 -->
      <div class="fixed top-4 left-4 z-50 lg:hidden">
        <button id="sidebarToggle" class="p-2 rounded-lg glass-btn">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      
      <!-- 移动端遮罩层 - 只在移动端显示 -->
      <div id="mobileOverlay" class="fixed inset-0 bg-black/30 z-40 mobile-overlay lg:hidden"></div>
      
      <!-- 桌面侧边栏开关按钮 -->
      <div class="fixed top-4 left-4 z-50 hidden lg:block">
        <label for="sidebar-toggle" class="p-2 rounded-lg glass-btn inline-block cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </label>
      </div>
      
      <!-- 侧边栏导航 -->
      <aside id="sidebar" class="sidebar fixed left-0 top-0 h-full w-64 z-50 overflow-y-auto mobile-sidebar lg:transform-none transition-all duration-300">
        <div class="p-6">
          <div class="flex items-center justify-between mb-8">
            <h2 class="text-2xl font-bold text-primary-600 tracking-tight">${escapeHTML(siteSettings.site_title)}</h2>
            <button id="closeSidebar" class="p-1 rounded-full hover:bg-gray-100 lg:hidden">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <label for="sidebar-toggle" class="p-1 rounded-full hover:bg-gray-100 hidden lg:block cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </label>
          </div>
          
          <div class="mb-6">
            <div class="relative">
              <input id="searchInput" type="text" placeholder="搜索书签..." class="w-full pl-10 pr-4 py-2 rounded-lg glass-search focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          <div>
            <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">分类导航</h3>
            <div class="space-y-1">
              <a href="?" class="category-link flex items-center px-3 py-2 rounded-lg ${catalogExists ? 'hover:bg-gray-100/60' : 'bg-secondary-100/80 text-primary-700 font-semibold active'} w-full text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 ${catalogExists ? 'text-gray-400' : 'text-primary-600'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                全部
                <span class="ml-auto text-xs text-gray-400">${totalSites}</span>
              </a>
              ${catalogLinkMarkup}
            </div>
          </div>
          
          <div class="mt-5 pt-4 border-t border-gray-200/70 space-y-1">
            <a href="/admin" target="_blank" class="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-600 transition-colors">
              <span class="w-8 h-8 rounded-lg bg-primary-50 text-primary-500 flex items-center justify-center shrink-0 group-hover:bg-primary-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </span>
              后台管理
            </a>

            <a href="https://github.com/bayueqi/ZQ-NAV" target="_blank" class="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-600 transition-colors">
              <span class="w-8 h-8 rounded-lg bg-primary-50 text-primary-500 flex items-center justify-center shrink-0 group-hover:bg-primary-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
              </span>
              项目地址
            </a>

            <a href="https://qizhouPavilion.520jk.cc.cd" target="_blank" class="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-600 transition-colors">
              <span class="w-8 h-8 rounded-lg bg-primary-50 text-primary-500 flex items-center justify-center shrink-0 group-hover:bg-primary-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </span>
              配套软件
            </a>
          </div>
        </div>
      </aside>
      
      <!-- 主内容区 -->
      <main class="main-content lg:ml-64 min-h-screen transition-all duration-300">
        <!-- 顶部横幅 -->
        <header class="hero-header text-white py-10 px-6 md:px-10 shadow-sm relative z-10">
          <div class="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
            <div class="flex-1 text-center md:text-left">
              <h1 class="text-3xl md:text-4xl font-semibold tracking-tight drop-shadow-sm">${escapeHTML(siteSettings.site_title)}</h1>
              <p class="mt-3 text-sm md:text-base text-secondary-100/90 leading-relaxed">
                ${escapeHTML(siteSettings.site_subtitle)}
              </p>
            </div>
            <div class="w-full md:w-auto flex justify-center md:justify-end">
              <div class="glass-stats rounded-2xl px-6 py-4 text-center">
                <p class="text-[11px] uppercase tracking-[0.18em] text-secondary-100/60">Overview</p>
                <div class="mt-3 flex items-center justify-center gap-4">
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-2xl font-semibold leading-none tabular-nums">${totalSites}</span>
                    <span class="text-xs text-secondary-100/70">书签</span>
                  </div>
                  <span class="h-6 w-px bg-white/20"></span>
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-2xl font-semibold leading-none tabular-nums">${catalogs.length}</span>
                    <span class="text-xs text-secondary-100/70">分类</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>
        
        <!-- 网站列表 -->
        <section class="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <!-- 当前分类/搜索提示 -->
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold text-gray-800" data-role="list-heading" data-default="${headingDefaultAttr}" data-active="${headingActiveAttr}">
              ${headingText}
            </h2>
            <div class="text-sm text-gray-500 hidden md:block">
              <script>
                 fetch('https://v1.hitokoto.cn')
                      .then(response => response.json())
                      .then(data => {
                       const hitokoto = document.getElementById('hitokoto_text')
                      hitokoto.href = 'https://github.com/bayueqi'
                      hitokoto.innerText = data.hitokoto
                      })
                      .catch(console.error)
              </script>
              <div id="hitokoto"><a href="#" target="_blank" id="hitokoto_text">疏影横斜水清浅，暗香浮动月黄昏。</a></div>
            </div>
          </div>
          
          <!-- 网站卡片网格 -->
          <div class="rounded-2xl ${currentSites.length ? 'border border-white/40 bg-white/40 backdrop-blur-md p-4 sm:p-6 shadow-sm' : 'hidden'}">
            <div id="sitesGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              ${currentSites.map((site, idx) => {
              const rawName = site.name || '未命名';
              const rawCatalog = site.catelog || '未分类';
              const rawDesc = site.desc || '暂无描述';
              const normalizedUrl = sanitizeUrl(site.url);
              const dataUrlAttr = escapeHTML(normalizedUrl || '');
              const logoUrl = sanitizeUrl(site.logo);
              const cardInitial = escapeHTML((rawName.trim().charAt(0) || '站').toUpperCase());
              const safeName = escapeHTML(rawName);
              const safeCatalog = escapeHTML(rawCatalog);
              const safeDesc = escapeHTML(rawDesc);
              const safeDataName = escapeHTML(site.name || '');
              const safeDataCatalog = escapeHTML(site.catelog || '');
              const hasValidUrl = Boolean(normalizedUrl);
              
              let logoHTML;
              let finalIconUrl = null;
              
              if (logoUrl) {
                // 如果有logo URL，优先使用
                finalIconUrl = escapeHTML(logoUrl);
              } else if (normalizedUrl) {
                // 如果没有logo URL但有网站URL，使用图标API
                try {
                  const url = new URL(normalizedUrl);
                  const domain = url.hostname;
                  finalIconUrl = escapeHTML(faviconApi.replace('{domain}', domain));
                } catch (error) {
                  // URL解析失败，继续使用首字母
                }
              }
              
              if (finalIconUrl) {
                // 使用懒加载：先显示首字母，然后懒加载图标
                logoHTML = `
                  <div class="logo-container relative w-10 h-10" data-icon-url="${finalIconUrl}" data-site-name="${safeDataName}" data-initial="${cardInitial}">
                    <div class="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold text-lg shadow-inner logo-placeholder">${cardInitial}</div>
                    <img alt="${safeName}" class="w-10 h-10 rounded-lg object-cover bg-gray-100 absolute top-0 left-0 opacity-0 logo-img" loading="lazy" onload="handleIconLoad(this)" onerror="handleIconError(this, '${cardInitial}')"/>
                  </div>
                `;
              } else {
                // 没有图标，直接使用首字母
                logoHTML = `<div class="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold text-lg shadow-inner">${cardInitial}</div>`;
              }
              
              return `
                <div class="site-card group rounded-xl overflow-hidden ${hasValidUrl ? 'cursor-pointer' : ''}" data-id="${site.id}" data-name="${safeDataName}" data-url="${dataUrlAttr}" data-catalog="${safeDataCatalog}" data-desc="${safeDesc}">
                  <div class="p-5">
                    <div class="flex items-start">
                      <div class="flex-shrink-0 mr-4">
                        ${logoHTML}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <h3 class="text-base font-medium text-gray-900 truncate flex-1" title="${safeName}">${safeName}</h3>
                          ${hasValidUrl ? `
                          <button class="preview-btn p-1 rounded-full hover:bg-primary-100 text-primary-600 transition-colors" data-url="${dataUrlAttr}" data-name="${safeName}" title="在当前页面预览">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                            </svg>
                          </button>
                          ` : ''}
                        </div>
                        <span class="inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-xs font-medium bg-secondary-100 text-primary-700">
                          ${safeCatalog}
                        </span>
                      </div>
                    </div>

                    <div class="mt-2 flex items-start gap-2">
                      <p class="flex-1 text-sm text-gray-600 leading-relaxed line-clamp-2" title="${safeDesc}">${safeDesc}</p>
                      <button class="copy-btn relative flex-shrink-0 flex items-center px-2 py-1 ${hasValidUrl ? 'bg-accent-100 text-accent-700 hover:bg-accent-200' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} rounded-full text-xs font-medium transition-colors" data-url="${dataUrlAttr}" ${hasValidUrl ? '' : 'disabled'}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        复制链接
                        <span class="copy-success hidden absolute -top-8 right-0 bg-accent-500 text-white text-xs px-2 py-1 rounded shadow-md">已复制!</span>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
            </div>
          </div>
        </section>
        
        <!-- 页脚 -->
        <footer class="glass-footer py-8 px-6 mt-12">
          <div class="max-w-5xl mx-auto text-center">
            <p class="text-gray-500">© ${new Date().getFullYear()} ${escapeHTML(siteSettings.site_title)} | 愿你在此找到方向</p>
          </div>
        </footer>
      </main>
      
      <!-- 返回顶部按钮 -->
      <button id="backToTop" class="back-top-btn fixed bottom-8 right-8 p-3 rounded-full text-white opacity-0 invisible">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 11l7-7 7 7M5 19l7-7 7 7" />
        </svg>
      </button>
      
      <!-- 网站预览模态框 -->
      <div id="previewModal" class="preview-modal fixed inset-0 z-[60] flex flex-col bg-black/60 opacity-0 invisible transition-all duration-300">
        <div class="flex items-center justify-between p-4 bg-white/90 backdrop-blur-xl shadow-md border-b border-gray-100/50">
          <h2 id="previewTitle" class="text-lg font-semibold text-gray-900"></h2>
          <div class="flex items-center gap-3">
            <a id="previewExternalLink" href="#" target="_blank" rel="noopener noreferrer" class="text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6h-6" />
              </svg>
              在新标签页打开
            </a>
            <button id="closePreview" class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex-1 p-2">
          <iframe id="previewIframe" class="w-full h-full rounded-lg border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </div>
      </div>
      
      <script>
        // 全局配置
        const faviconApi = '${faviconApi}';
        
        // 图标加载成功处理函数
        function handleIconLoad(img) {
          img.classList.remove('opacity-0');
          img.classList.add('opacity-100', 'transition-opacity', 'duration-300');
        }
        
        // 图标错误处理函数
        function handleIconError(img, initial) {
          img.onerror = null;
          const parent = img.parentElement;
          if (parent && parent.classList.contains('logo-container')) {
            // 对于新的懒加载结构，隐藏 img 并保留占位符
            img.style.display = 'none';
          } else {
            // 旧的处理逻辑
            img.remove();
            if (parent) {
              parent.innerHTML = '<div class="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold text-lg shadow-inner">' + initial + '</div>';
            }
          }
        }
        
        // 图标懒加载初始化
        function initLazyLoadIcons() {
          const logoContainers = document.querySelectorAll('.logo-container');
          
          if ('IntersectionObserver' in window) {
            const iconObserver = new IntersectionObserver((entries, observer) => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  const container = entry.target;
                  const iconUrl = container.dataset.iconUrl;
                  const img = container.querySelector('.logo-img');
                  
                  if (img && iconUrl) {
                    img.src = iconUrl;
                  }
                  
                  observer.unobserve(container);
                }
              });
            }, {
              rootMargin: '100px 0px', // 提前100px加载
              threshold: 0.1
            });
            
            logoContainers.forEach(container => {
              iconObserver.observe(container);
            });
          } else {
            // 不支持 IntersectionObserver 时降级为立即加载
            logoContainers.forEach(container => {
              const iconUrl = container.dataset.iconUrl;
              const img = container.querySelector('.logo-img');
              if (img && iconUrl) {
                img.src = iconUrl;
              }
            });
          }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
          // 初始化图标懒加载
          initLazyLoadIcons();
          
          // 侧边栏控制
          const sidebar = document.getElementById('sidebar');
          const mobileOverlay = document.getElementById('mobileOverlay');
          const sidebarToggle = document.getElementById('sidebarToggle');
          const closeSidebar = document.getElementById('closeSidebar');
          
          function openSidebar() {
            sidebar.classList.add('open');
            mobileOverlay.classList.add('open');
            document.body.style.overflow = 'hidden';
          }
          
          function closeSidebarMenu() {
            sidebar.classList.remove('open');
            mobileOverlay.classList.remove('open');
            document.body.style.overflow = '';
          }
          
          if (sidebarToggle) sidebarToggle.addEventListener('click', openSidebar);
          if (closeSidebar) closeSidebar.addEventListener('click', closeSidebarMenu);
          if (mobileOverlay) mobileOverlay.addEventListener('click', closeSidebarMenu);
          
          // 复制链接功能
          document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              const url = this.getAttribute('data-url');
              if (!url) {
                return;
              }
              navigator.clipboard.writeText(url).then(() => {
                const successMsg = this.querySelector('.copy-success');
                successMsg.classList.remove('hidden');
                successMsg.classList.add('copy-success-animation');
                setTimeout(() => {
                  successMsg.classList.add('hidden');
                  successMsg.classList.remove('copy-success-animation');
                }, 2000);
              }).catch(err => {
                console.error('复制失败:', err);
                // 备用复制方法
                const textarea = document.createElement('textarea');
                textarea.value = url;
                textarea.style.position = 'fixed';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                try {
                  document.execCommand('copy');
                  const successMsg = this.querySelector('.copy-success');
                  successMsg.classList.remove('hidden');
                  successMsg.classList.add('copy-success-animation');
                  setTimeout(() => {
                    successMsg.classList.add('hidden');
                    successMsg.classList.remove('copy-success-animation');
                  }, 2000);
                } catch (e) {
                  console.error('备用复制也失败了:', e);
                  alert('复制失败，请手动复制');
                }
                document.body.removeChild(textarea);
              });
            });
          });
          
          // 返回顶部按钮
          const backToTop = document.getElementById('backToTop');
          
          window.addEventListener('scroll', function() {
            if (window.pageYOffset > 300) {
              backToTop.classList.add('visible');
            } else {
              backToTop.classList.remove('visible');
            }
          }, { passive: true });
          
          if (backToTop) {
            backToTop.addEventListener('click', function() {
              window.scrollTo({
                top: 0,
                behavior: 'smooth'
              });
            });
          }
          
          // 网站预览功能
          const previewModal = document.getElementById('previewModal');
          const previewIframe = document.getElementById('previewIframe');
          const previewTitle = document.getElementById('previewTitle');
          const previewExternalLink = document.getElementById('previewExternalLink');
          const closePreview = document.getElementById('closePreview');
          
          function openPreviewModal(url, name) {
            if (previewModal && previewIframe && previewTitle && previewExternalLink) {
              previewTitle.textContent = name;
              previewExternalLink.href = url;
              previewIframe.src = url;
              previewModal.classList.add('visible');
              document.body.style.overflow = 'hidden';
            }
          }
          
          function closePreviewModal() {
            if (previewModal && previewIframe) {
              previewModal.classList.remove('visible');
              previewIframe.src = '';
              document.body.style.overflow = '';
            }
          }
          
          // 为所有预览按钮添加点击事件
          document.querySelectorAll('.preview-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              const url = this.getAttribute('data-url');
              const name = this.getAttribute('data-name');
              if (url) {
                openPreviewModal(url, name);
              }
            });
          });

          // 点击书签卡片跳转到对应链接（按钮区域不触发跳转）
          document.querySelectorAll('.site-card').forEach(card => {
            card.addEventListener('click', function(e) {
              // 点击复制按钮、预览按钮等交互元素时不跳转
              if (e.target.closest('.copy-btn, .preview-btn, button, a')) return;
              const url = this.getAttribute('data-url');
              if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            });
          });

          if (closePreview) {
            closePreview.addEventListener('click', closePreviewModal);
          }
          
          // 点击模态框背景关闭
          if (previewModal) {
            previewModal.addEventListener('click', function(e) {
              if (e.target === previewModal) {
                closePreviewModal();
              }
            });
          }
          
          // ESC 键关闭模态框
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              closePreviewModal();
            }
          });
          
          // 搜索功能
          const searchInput = document.getElementById('searchInput');
          const sitesGrid = document.getElementById('sitesGrid');
          const siteCards = document.querySelectorAll('.site-card');
          
          if (searchInput && sitesGrid) {
            searchInput.addEventListener('input', function() {
              const keyword = this.value.toLowerCase().trim();
              
              siteCards.forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const url = (card.getAttribute('data-url') || '').toLowerCase();
                const catalogValue = (card.getAttribute('data-catalog') || '').toLowerCase();
                const desc = (card.getAttribute('data-desc') || '').toLowerCase();
                
                if (name.includes(keyword) || url.includes(keyword) || catalogValue.includes(keyword) || desc.includes(keyword)) {
                  card.classList.remove('hidden');
                  // 搜索结果无论是否在视口内都直接显示
                  card.classList.add('is-visible');
                } else {
                  card.classList.add('hidden');
                }
              });
              
              // 搜索结果提示
              const visibleCards = sitesGrid.querySelectorAll('.site-card:not(.hidden)');
              const countHeading = document.querySelector('[data-role="list-heading"]');
              if (countHeading) {
                const defaultText = countHeading.dataset.default || '';
                const activeCatalogText = countHeading.dataset.active || '';
                if (keyword) {
                  countHeading.textContent = '搜索结果 · ' + visibleCards.length + ' 个网站';
                } else if (activeCatalogText) {
                  countHeading.textContent = activeCatalogText + ' · ' + visibleCards.length + ' 个网站';
                } else {
                  const totalText = defaultText.includes('全部') ? defaultText.replace(/\\d+ 个网站/, visibleCards.length + ' 个网站') : '全部 · ' + visibleCards.length + ' 个网站';
                  countHeading.textContent = totalText;
                }
              }
            });
          }

          // 卡片滚动进入视口时触发弹出动画
          const revealCards = document.querySelectorAll('.site-card');
          if ('IntersectionObserver' in window && revealCards.length) {
            const cardObserver = new IntersectionObserver(function(entries, observer) {
              entries.forEach(function(entry, i) {
                if (entry.isIntersecting) {
                  // 同时进入视口的多张卡片错落弹出
                  setTimeout(function() {
                    entry.target.classList.add('is-visible');
                  }, Math.min(i * 50, 300));
                  observer.unobserve(entry.target);
                }
              });
            }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
            revealCards.forEach(function(card) { cardObserver.observe(card); });
          } else {
            // 降级：不支持 IntersectionObserver 时全部直接显示
            revealCards.forEach(function(card) { card.classList.add('is-visible'); });
          }

          // 分类展开/折叠 - 使用localStorage记住展开状态
          const EXPANDED_KEY = 'nav_expanded_cats';
          function getExpandedSet() {
            try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]')); } catch(e) { return new Set(); }
          }
          function saveExpandedSet(set) {
            try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set])); } catch(e) {}
          }

          const set = getExpandedSet();

          // 1. 服务端已展开当前分类祖先（无闪烁），将它们记入localStorage
          document.querySelectorAll('.cat-expand-btn.expanded').forEach(btn => {
            set.add(btn.getAttribute('data-target'));
          });

          // 2. 恢复localStorage中记住的其他展开分类
          document.querySelectorAll('.cat-expand-btn').forEach(btn => {
            const targetId = btn.getAttribute('data-target');
            const target = document.getElementById(targetId);
            if (!target) return;
            if (set.has(targetId)) {
              target.classList.remove('collapsed');
              btn.classList.add('expanded');
            }
          });

          // 保存初始状态
          saveExpandedSet(set);

          // 3. 绑定展开/折叠点击事件
          document.querySelectorAll('.cat-expand-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              const targetId = this.getAttribute('data-target');
              const target = document.getElementById(targetId);
              if (!target) return;
              const s = getExpandedSet();
              if (target.classList.contains('collapsed')) {
                target.classList.remove('collapsed');
                this.classList.add('expanded');
                this.title = '折叠';
                s.add(targetId);
              } else {
                target.classList.add('collapsed');
                this.classList.remove('expanded');
                this.title = '展开';
                s.delete(targetId);
              }
              saveExpandedSet(s);
            });
          });
        });
      </script>
    </body>
    </html>
    `;

    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
}


// 导出主模块
export default {
async fetch(request, env, ctx) {
  const url = new URL(request.url);

  // 静态资源不读 D1，直接返回，省掉建表任务的等待
  if (url.pathname.startsWith('/static/')) {
    return admin.handleStatic(request, env, ctx);
  }

  // 确保分类表存在并迁移数据（实例内只执行一次）
  try {
    await ensureCategoriesTable(env);
  } catch(e) {
    console.error('ensureCategoriesTable error:', e);
  }

  if (url.pathname.startsWith('/api')) {
    return api.handleRequest(request, env, ctx);
  } else if (url.pathname === '/admin') {
    return admin.handleRequest(request, env, ctx);
  } else {
    return handleRequest(request, env, ctx);
  }
},
};
