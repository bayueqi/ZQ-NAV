export const fallbackSVGIcons = [
  `<svg width="80" height="80" viewBox="0 0 24 24" fill="url(#gradient1)" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="#7209b7" />
         <stop offset="100%" stop-color="#4cc9f0" />
       </linearGradient>
     </defs>
     <path d="M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z"/>
   </svg>`,
  `<svg width="80" height="80" viewBox="0 0 24 24" fill="url(#gradient2)" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="#4361ee" />
         <stop offset="100%" stop-color="#4cc9f0" />
       </linearGradient>
     </defs>
     <circle cx="12" cy="12" r="10"/>
     <path d="M12 7v5l3.5 3.5 1.42-1.42L14 11.58V7h-2z" fill="#fff"/>
   </svg>`,
  `<svg width="80" height="80" viewBox="0 0 24 24" fill="url(#gradient3)" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="gradient3" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="#7209b7" />
         <stop offset="100%" stop-color="#4361ee" />
       </linearGradient>
     </defs>
     <path d="M12 .587l3.668 7.431L24 9.172l-6 5.843 1.416 8.252L12 19.771l-7.416 3.496L6 15.015 0 9.172l8.332-1.154z"/>
   </svg>`,
];



function getRandomSVG() {
  return fallbackSVGIcons[Math.floor(Math.random() * fallbackSVGIcons.length)];
}

/**
 * 获取图标 API URL
 */
function getIconApiUrl(env) {
  try {
    const iconApiUrl = env.FaviconApi;
    if (iconApiUrl) {
      return iconApiUrl;
    }
  } catch (error) {
    console.error('Get icon API URL error:', error);
  }
  return 'https://toolb.cn/favicon/{domain}';
}

/**
 * 渲染单个网站卡片（优化版）
 */
function renderSiteCard(site, env) {
  let logoHTML;
  const safeName = site.name || '';
  
  if (site.logo) {
    // 如果有logo URL，优先使用
    logoHTML = `<img src="${site.logo}" alt="${safeName}" data-site-name="${safeName}" onerror="this.onerror=null; this.remove(); if(this.parentElement && this.dataset.siteName) { this.parentElement.innerHTML = this.dataset.siteName.charAt(0).toUpperCase(); }"/>`;
  } else if (site.url) {
    // 如果没有logo URL但有网站URL，使用图标API
    try {
      const url = new URL(site.url);
      const domain = url.hostname;
      const iconUrl = getIconApiUrl(env).replace('{domain}', domain);
      logoHTML = `<img src="${iconUrl}" alt="${safeName}" data-site-name="${safeName}" onerror="this.onerror=null; this.remove(); if(this.parentElement && this.dataset.siteName) { this.parentElement.innerHTML = this.dataset.siteName.charAt(0).toUpperCase(); }"/>`;
    } catch (error) {
      // 如果URL解析失败，使用首字母
      logoHTML = safeName ? safeName.charAt(0).toUpperCase() : '?';
    }
  } else {
    // 如果都没有，使用首字母
    logoHTML = safeName ? safeName.charAt(0).toUpperCase() : getRandomSVG();
  }

  return `
    <div class="channel-card" data-id="${site.id}">
      <div class="channel-number">${site.sort_order}</div>
      <h3 class="channel-title">${site.name || '未命名'}</h3>
      <span class="channel-tag">${site.catelog}</span>
      <div class="logo-wrapper">${logoHTML}</div>
      <p class="channel-desc">${site.desc || '暂无描述'}</p>
      <a href="${site.url}" target="_blank" class="channel-link">${site.url}</a>
      <button class="copy-btn" data-url="${site.url}" title="复制链接">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
      <div class="copy-success">已复制!</div>
    </div>
  `;
}

function escapeHTML(input) {
  if (input === null || input === undefined) {
    return '';
  }
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
async function ensureCategoriesTable(env) {
  try {
    await env.NAV_DB.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT 0,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    // 创建管理员会话表（替代KV存储）
    await env.NAV_DB.prepare(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `).run();
  } catch (e) {
    console.error('Failed to create tables:', e);
  }
  // 清理过期会话
  try {
    await env.NAV_DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  } catch (e) {
    // 表可能还不存在，忽略
  }
  // 迁移现有分类：从 sites 表的 catelog 字段提取一级分类
  try {
    const { results: existingCats } = await env.NAV_DB.prepare('SELECT COUNT(*) as cnt FROM categories').first();
    if (existingCats === 0) {
      const { results: catelogs } = await env.NAV_DB.prepare(
        'SELECT DISTINCT catelog FROM sites WHERE catelog IS NOT NULL AND catelog != \'\' '
      ).all();
      for (const row of catelogs) {
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
          const existing = await env.NAV_DB.prepare('SELECT id FROM categories WHERE path = ?').bind(currentPath).first();
          if (existing) {
            currentParentId = existing.id;
          } else {
            const result = await env.NAV_DB.prepare(
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

function getCategoryDescendantPaths(categories, parentPath) {
  const paths = [parentPath];
  for (const cat of categories) {
    if (cat.path === parentPath || cat.path.startsWith(parentPath + '/')) {
      if (cat.path !== parentPath) {
        paths.push(cat.path);
      }
    }
  }
  return paths;
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
    // 删除没有书签且没有子分类的分类（递归清理）
    let deleted = 0;
    let keepGoing = true;
    while (keepGoing) {
      const { results: orphans } = await env.NAV_DB.prepare(`
        SELECT c.id FROM categories c
        LEFT JOIN sites s ON s.catelog = c.path
        LEFT JOIN categories child ON child.parent_id = c.id
        WHERE s.id IS NULL AND child.id IS NULL
      `).all();
      if (orphans.length === 0) {
        keepGoing = false;
      } else {
        for (const orphan of orphans) {
          await env.NAV_DB.prepare('DELETE FROM categories WHERE id = ?').bind(orphan.id).run();
          deleted++;
        }
      }
    }
    return deleted;
  } catch (e) {
    console.error('cleanupOrphanCategories error:', e);
    return 0;
  }
}

// 同步分类路径：确保路径中每一级分类都存在于 categories 表中
async function syncCategoryPath(env, catelogPath) {
  if (!catelogPath) return;
  const path = (catelogPath || '').trim();
  if (!path) return;
  const parts = path.split('/').map(p => p.trim()).filter(p => p);
  if (parts.length === 0) return;
  
  let currentParentId = 0;
  let currentPath = '';
  for (const part of parts) {
    currentPath = currentPath ? currentPath + '/' + part : part;
    const existing = await env.NAV_DB.prepare('SELECT id FROM categories WHERE path = ?').bind(currentPath).first();
    if (existing) {
      currentParentId = existing.id;
    } else {
      // 获取同级最大sort_order + 1
      const maxSort = await env.NAV_DB.prepare(
        'SELECT MAX(sort_order) as max_sort FROM categories WHERE parent_id = ?'
      ).bind(currentParentId).first();
      const sortOrder = (maxSort && maxSort.max_sort !== null) ? maxSort.max_sort + 1 : 0;
      const result = await env.NAV_DB.prepare(
        'INSERT INTO categories (name, parent_id, path, sort_order) VALUES (?, ?, ?, ?)'
      ).bind(part, currentParentId, currentPath, sortOrder).run();
      currentParentId = result.meta.last_row_id;
    }
  }
}

function isSubmissionEnabled(env) {
  const flag = env.ENABLE_PUBLIC_SUBMISSION;
  if (flag === undefined || flag === null) {
    return true;
  }
  const normalized = String(flag).trim().toLowerCase();
  return normalized === 'true';
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
    const session = await env.NAV_DB.prepare(
      'SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime(\'now\')'
    ).bind(token).first();
    if (!session) {
      return { authenticated: false };
    }
    // 会话有效，刷新过期时间（不await，不阻塞响应）
    refreshAdminSession(env, token).catch(() => {});
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
            if (path === '/config') {
                switch (method) {
                    case 'GET':
                        return await this.getConfig(request, env, ctx, url);
                    case 'POST':
                        if (!(await isAdminAuthenticated(request, env))) {
                            return this.errorResponse('Unauthorized', 401);
                        }
                        return await this.createConfig(request, env, ctx);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
            if (path === '/config/submit' && method === 'POST') {
              if (!isSubmissionEnabled(env)) {
                return this.errorResponse('Public submission disabled', 403);
              }
              return await this.submitConfig(request, env, ctx);
           }
           if (path === '/categories') {
              if (!(await isAdminAuthenticated(request, env))) {
                  return this.errorResponse('Unauthorized', 401);
              }
              if (method === 'GET') {
                  return await this.getCategories(request, env, ctx);
              }
              if (method === 'POST') {
                  return await this.createCategory(request, env, ctx);
              }
              return this.errorResponse('Method Not Allowed', 405);
           }
            if (path.startsWith('/categories/')) {
                if (!(await isAdminAuthenticated(request, env))) {
                    return this.errorResponse('Unauthorized', 401);
                }
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
                        if (!(await isAdminAuthenticated(request, env))) {
                            return this.errorResponse('Unauthorized', 401);
                        }
                        return await this.updateConfig(request, env, ctx, id);
                    case 'DELETE':
                        if (!(await isAdminAuthenticated(request, env))) {
                            return this.errorResponse('Unauthorized', 401);
                        }
                        return await this.deleteConfig(request, env, ctx, id);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
              if (path.startsWith('/pending/') && /^\d+$/.test(id)) {
                switch (method) {
                    case 'PUT':
                        if (!(await isAdminAuthenticated(request, env))) {
                            return this.errorResponse('Unauthorized', 401);
                        }
                        return await this.approvePendingConfig(request, env, ctx, id);
                    case 'DELETE':
                        if (!(await isAdminAuthenticated(request, env))) {
                            return this.errorResponse('Unauthorized', 401);
                        }
                        return await this.rejectPendingConfig(request, env, ctx, id);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
            if (path === '/config/import' && method === 'POST') {
                if (!(await isAdminAuthenticated(request, env))) {
                    return this.errorResponse('Unauthorized', 401);
                }
                return await this.importConfig(request, env, ctx);
            }
            if (path === '/config/export' && method === 'GET') {
                if (!(await isAdminAuthenticated(request, env))) {
                    return this.errorResponse('Unauthorized', 401);
                }
                return await this.exportConfig(request, env, ctx);
            }
            if (path === '/pending' && method === 'GET') {
              if (!(await isAdminAuthenticated(request, env))) {
                  return this.errorResponse('Unauthorized', 401);
              }
              return await this.getPendingConfig(request, env, ctx, url);
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
              const catalog = url.searchParams.get('catalog');
              const page = parseInt(url.searchParams.get('page') || '1', 10);
              const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
              const keyword = url.searchParams.get('keyword');
              const offset = (page - 1) * pageSize;
                            try {
                  //- [优化] 调整了SQL查询语句，增加了 sort_order 排序
                  let query = `SELECT * FROM sites ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                  let countQuery = `SELECT COUNT(*) as total FROM sites`;
                  let queryBindParams = [pageSize, offset];
                  let countQueryParams = [];
  
                  if (catalog) {
                      // 包含该分类及其所有子分类
                      const childPrefix = catalog + '/';
                      query = `SELECT * FROM sites WHERE (catelog = ? OR catelog LIKE ?) ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                      countQuery = `SELECT COUNT(*) as total FROM sites WHERE (catelog = ? OR catelog LIKE ?)`;
                      queryBindParams = [catalog, childPrefix + '%', pageSize, offset];
                      countQueryParams = [catalog, childPrefix + '%'];
                  }
  
                  if (keyword) {
                      const likeKeyword = `%${keyword}%`;
                      query = `SELECT * FROM sites WHERE name LIKE ? OR url LIKE ? OR catelog LIKE ? OR desc LIKE ? ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                      countQuery = `SELECT COUNT(*) as total FROM sites WHERE name LIKE ? OR url LIKE ? OR catelog LIKE ? OR desc LIKE ?`;
                      queryBindParams = [likeKeyword, likeKeyword, likeKeyword, likeKeyword, pageSize, offset];
                      countQueryParams = [likeKeyword, likeKeyword, likeKeyword, likeKeyword];

                      if (catalog) {
                          const childPrefix = catalog + '/';
                          query = `SELECT * FROM sites WHERE (catelog = ? OR catelog LIKE ?) AND (name LIKE ? OR url LIKE ? OR catelog LIKE ? OR desc LIKE ?) ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                          countQuery = `SELECT COUNT(*) as total FROM sites WHERE (catelog = ? OR catelog LIKE ?) AND (name LIKE ? OR url LIKE ? OR catelog LIKE ? OR desc LIKE ?)`;
                          queryBindParams = [catalog, childPrefix + '%', likeKeyword, likeKeyword, likeKeyword, likeKeyword, pageSize, offset];
                          countQueryParams = [catalog, childPrefix + '%', likeKeyword, likeKeyword, likeKeyword, likeKeyword];
                      }
                  }
  
                  const { results } = await env.NAV_DB.prepare(query).bind(...queryBindParams).all();
                  const countResult = await env.NAV_DB.prepare(countQuery).bind(...countQueryParams).first();
                  const total = countResult ? countResult.total : 0;
  
                return new Response(
                  JSON.stringify({
                      code: 200,
                      data: results,
                      total,
                      page,
                      pageSize
                  }),
                  { headers: { 'Content-Type': 'application/json' } }
              );
              
              } catch (e) {
                  return this.errorResponse(`Failed to fetch config data: ${e.message}`, 500)
              }
          },
      async getPendingConfig(request, env, ctx, url) {
            const page = parseInt(url.searchParams.get('page') || '1', 10);
            const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
            const offset = (page - 1) * pageSize;
            try {
                const { results } = await env.NAV_DB.prepare(`
                        SELECT * FROM pending_sites ORDER BY create_time DESC LIMIT ? OFFSET ?
                    `).bind(pageSize, offset).all();
                  const countResult = await env.NAV_DB.prepare(`
                      SELECT COUNT(*) as total FROM pending_sites
                      `).first();
                const total = countResult ? countResult.total : 0;
                  return new Response(
                      JSON.stringify({
                        code: 200,
                        data: results,
                          total,
                        page,
                        pageSize
                      }),
                      {headers: {'Content-Type': 'application/json'}}
                  );
            } catch (e) {
                return this.errorResponse(`Failed to fetch pending config data: ${e.message}`, 500);
            }
        },
        async approvePendingConfig(request, env, ctx, id) {
            try {
                const { results } = await env.NAV_DB.prepare('SELECT * FROM pending_sites WHERE id = ?').bind(id).all();
                if(results.length === 0) {
                    return this.errorResponse('Pending config not found', 404);
                }
                const config = results[0];
                let targetSortOrder = 1;
                if (!config.sort_order || config.sort_order === '' || config.sort_order === 9999) {
                    const maxSortResult = await env.NAV_DB.prepare('SELECT MAX(sort_order) as max_sort FROM sites WHERE sort_order != 9999').first();
                    targetSortOrder = (maxSortResult && maxSortResult.max_sort ? maxSortResult.max_sort + 1 : 1);
                } else {
                    targetSortOrder = parseInt(config.sort_order) || 1;
                }
                await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order != 9999').bind(targetSortOrder).run();
                await env.NAV_DB.prepare(`
                    INSERT INTO sites (name, url, desc, logo, catelog, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(config.name, config.url, config.desc, config.logo, config.catelog, targetSortOrder).run();
                await env.NAV_DB.prepare('DELETE FROM pending_sites WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({
                    code: 200,
                    message: 'Pending config approved successfully'
                }),{
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            }catch(e) {
                return this.errorResponse(`Failed to approve pending config : ${e.message}`, 500);
            }
        },
        async rejectPendingConfig(request, env, ctx, id) {
            try{
                await env.NAV_DB.prepare('DELETE FROM pending_sites WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({
                    code: 200,
                    message: 'Pending config rejected successfully',
                }), {headers: {'Content-Type': 'application/json'}});
            } catch(e) {
                return this.errorResponse(`Failed to reject pending config: ${e.message}`, 500);
            }
        },
       async submitConfig(request, env, ctx) {
          try{
              if (!isSubmissionEnabled(env)) {
                  return this.errorResponse('Public submission disabled', 403);
              }
              const config = await request.json();
              const { name, url, logo, desc, catelog } = config;
              const sanitizedName = (name || '').trim();
              const sanitizedUrl = (url || '').trim();
              const sanitizedCatelog = (catelog || '').trim();
              const sanitizedLogo = (logo || '').trim() || null;
              const sanitizedDesc = (desc || '').trim() || null;
  
              if (!sanitizedName || !sanitizedUrl || !sanitizedCatelog ) {
                  return this.errorResponse('Name, URL and Catelog are required', 400);
              }
              await env.NAV_DB.prepare(`
                  INSERT INTO pending_sites (name, url, logo, desc, catelog)
                  VALUES (?, ?, ?, ?, ?)
            `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, sanitizedCatelog).run();
  
            return new Response(JSON.stringify({
              code: 201,
              message: 'Config submitted successfully, waiting for admin approve',
            }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            })
          } catch(e) {
              return this.errorResponse(`Failed to submit config : ${e.message}`, 500);
          }
      },
      
      
    async createConfig(request, env, ctx) {
          try{
              const config = await request.json();
              const { name, url, logo, desc, catelog, sort_order } = config;
              const sanitizedName = (name || '').trim();
              const sanitizedUrl = (url || '').trim();
              const sanitizedCatelog = (catelog || '').trim();
              const sanitizedLogo = (logo || '').trim() || null;
              const sanitizedDesc = (desc || '').trim() || null;

              if (!sanitizedName || !sanitizedUrl || !sanitizedCatelog ) {
                  return this.errorResponse('Name, URL and Catelog are required', 400);
              }
              
              let targetSortOrder = 1;
              if (!sort_order || sort_order === '') {
                  const maxSortResult = await env.NAV_DB.prepare('SELECT MAX(sort_order) as max_sort FROM sites WHERE sort_order != 9999').first();
                  targetSortOrder = (maxSortResult && maxSortResult.max_sort ? maxSortResult.max_sort + 1 : 1);
              } else {
                  targetSortOrder = parseInt(sort_order) || 1;
              }
              
              await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order != 9999').bind(targetSortOrder).run();
              
              const insert = await env.NAV_DB.prepare(`
                    INSERT INTO sites (name, url, logo, desc, catelog, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
              `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, sanitizedCatelog, targetSortOrder).run();

              // 自动同步分类路径（新建不存在的分类节点）
              await syncCategoryPath(env, sanitizedCatelog);

            return new Response(JSON.stringify({
              code: 201,
              message: 'Config created successfully',
              insert
            }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            })
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
              const sanitizedCatelog = (catelog || '').trim();
              const sanitizedLogo = (logo || '').trim() || null;
              const sanitizedDesc = (desc || '').trim() || null;

            if (!sanitizedName || !sanitizedUrl || !sanitizedCatelog) {
              return this.errorResponse('Name, URL and Catelog are required', 400);
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

            return new Response(JSON.stringify({
                code: 200,
                message: 'Config updated successfully',
                update
            }), { headers: { 'Content-Type': 'application/json' }});
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
              
              const del = await env.NAV_DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run();
              
              if (deletedSortOrder !== 9999) {
                  await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order != 9999').bind(deletedSortOrder).run();
              }

              // 清理可能产生的空分类
              await cleanupOrphanCategories(env);
              
              return new Response(JSON.stringify({
                  code: 200,
                  message: 'Config deleted successfully',
                  del
              }), {headers: {'Content-Type': 'application/json'}});
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
            return new Response(JSON.stringify({
              code: 200,
              message: 'Import successful, but no data was found in file.'
            }), { headers: {'Content-Type': 'application/json'} });
          }

          const urls = sitesToImport.map(item => (item.url || '').trim()).filter(url => url);
          if (urls.length > 0) {
              const placeholders = urls.map(() => '?').join(',');
              await env.NAV_DB.prepare(`DELETE FROM sites WHERE url IN (${placeholders})`).bind(...urls).run();
          }

          const insertStatements = sitesToImport.map(item => {
                const sanitizedName = (item.name || '').trim() || null;
                const sanitizedUrl = (item.url || '').trim() || null;
                const sanitizedLogo = (item.logo || '').trim() || null;
                const sanitizedDesc = (item.desc || '').trim() || null;
                const sanitizedCatelog = (item.catelog || '').trim() || null;
                const sortOrderValue = normalizeSortOrder(item.sort_order);
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

          return new Response(JSON.stringify({
              code: 201,
              message: `Config imported successfully. ${sitesToImport.length} items processed.`
          }), {
              status: 201,
              headers: {'Content-Type': 'application/json'}
          });
        } catch (error) {
          return this.errorResponse(`Failed to import config : ${error.message}`, 500);
        }
      },
  
async exportConfig(request, env, ctx) {
        try{
          const { results } = await env.NAV_DB.prepare('SELECT * FROM sites ORDER BY sort_order ASC, create_time DESC').all();
          const pureJsonData = JSON.stringify(results, null, 2); 

          return new Response(pureJsonData, {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': 'attachment; filename="config.json"'
              }
          });
        } catch(e) {
          return this.errorResponse(`Failed to export config: ${e.message}`, 500)
        }
      },
      async getCategories(request, env, ctx) {
          try {
              // 先清理数据库中的孤儿分类（没有书签且没有子分类的空分类）
              await cleanupOrphanCategories(env);

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

              return new Response(JSON.stringify({
                  code: 200,
                  data: {
                      tree: tree,
                      flat: flatList,
                      total: totalSites
                  }
              }), { headers: { 'Content-Type': 'application/json' } });
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

              return new Response(JSON.stringify({
                  code: 201,
                  message: '分类创建成功',
                  data: {
                      id: result.meta.last_row_id,
                      name: name,
                      parent_id: parentId,
                      path: newPath,
                      sort_order: sortOrder
                  }
              }), { headers: { 'Content-Type': 'application/json' } });
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

              return new Response(JSON.stringify({
                  code: 200,
                  message: '分类更新成功'
              }), { headers: { 'Content-Type': 'application/json' } });
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

              return new Response(JSON.stringify({
                  code: 200,
                  message: '分类删除成功'
              }), { headers: { 'Content-Type': 'application/json' } });
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

              return new Response(JSON.stringify({
                  code: 200,
                  message: '移动成功'
              }), { headers: { 'Content-Type': 'application/json' } });
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
                  return new Response(JSON.stringify({
                      code: 200,
                      message: 'Category order reset successfully'
                  }), { headers: { 'Content-Type': 'application/json' } });
              }

              const sortOrderValue = normalizeSortOrder(body ? body.sort_order : undefined);
              await env.NAV_DB.prepare(`
                INSERT INTO category_orders (catelog, sort_order)
                VALUES (?, ?)
                ON CONFLICT(catelog) DO UPDATE SET sort_order = excluded.sort_order
              `).bind(normalizedCategory, sortOrderValue).run();

              return new Response(JSON.stringify({
                  code: 200,
                  message: 'Category order updated successfully'
              }), { headers: { 'Content-Type': 'application/json' } });
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
              
              return new Response(JSON.stringify({
                  code: 200,
                  message: 'Logged out successfully'
              }), { 
                  status: 200,
                  headers: { 
                      'Content-Type': 'application/json',
                      'Set-Cookie': clearCookie 
                  }
              });
          } catch (e) {
              return this.errorResponse(`Failed to logout: ${e.message}`, 500);
          }
      },
       errorResponse(message, status) {
          return new Response(JSON.stringify({code: status, message: message}), {
              status: status,
              headers: { 'Content-Type': 'application/json' },
          });
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

        const storedUsername = env.ADMIN_USERNAME;
        const storedPassword = env.ADMIN_PASSWORD;

        const isValid =
          storedUsername &&
          storedPassword &&
          name === storedUsername &&
          password === storedPassword;

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
            return new Response(fileContent, {
              headers: { 'Content-Type': contentType }
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
      <title>书签管理页面</title>
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
              <p class="admin-subtitle">管理后台仅限受信任的管理员使用，请妥善保管账号</p>
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
              <button id="logoutBtn" class="toolbar-btn toolbar-btn-logout" title="退出登录">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                <span>退出</span>
              </button>
            </div>
          </header>
      
          <div id="message" style="display: none;padding:1rem;border-radius: 0.5rem;margin-bottom: 1rem;"></div>
          <div class="add-new form-collapsed" id="addNewForm" style="display:none;">
            <input type="text" id="addName" placeholder="Name" required>
            <input type="text" id="addUrl" placeholder="URL" required>
            <input type="text" id="addLogo" placeholder="Logo(optional)">
            <input type="text" id="addDesc" placeholder="Description(optional)">
            <input type="text" id="addCatelog" placeholder="分类（用/分隔多级，如：工具/开发/前端）" required>
            <input type="number" id="addSortOrder" placeholder="排序 (数字小靠前)">
            <button id="addSubmitBtn">添加</button>
          </div>
         <div id="config">
                    <div class="config-layout">
                      <aside class="category-sidebar">
                        <div class="category-sidebar-header">
                          <h3>分类列表</h3>
                          <button id="refreshCategorySidebar" title="刷新分类">&#x21bb;</button>
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
                        <div class="table-wrapper">
                        <table id="configTable">
                            <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>URL</th>
                                  <th>Logo</th>
                                  <th>Description</th>
                                  <th>Catelog</th>
                                  <th>排序</th>
                                  <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="configTableBody">
                              <!-- data render by js -->
                            </tbody>
                        </table>
                        <div class="pagination">
                              <button id="prevPage" disabled>上一页</button>
                              <span id="currentPage">1</span>/<span id="totalPages">1</span>
                              <button id="nextPage" disabled>下一页</button>
                        </div>
                   </div>
                      </div>
                    </div>
                </div>
      </div>
      <script src="/static/admin.js"></script>
    </body>
    </html>`,
            'admin.css': `* {
        -webkit-tap-highlight-color: transparent;
    }
    html {
        scroll-behavior: smooth;
    }
    body {
        font-family: 'Noto Sans SC', sans-serif;
        margin: 0;
        padding: 10px;
        background: linear-gradient(135deg, #fdf8f3 0%, #f3f5f9 40%, #e8edf5 100%);
        background-attachment: fixed;
        min-height: 100vh;
        color: #2d3748;
    }
    /* 自定义滚动条 */
    ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
        border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb {
        background: rgba(108, 143, 186, 0.3);
        border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: rgba(65, 109, 157, 0.5);
    }
    .modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        background-color: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    .modal-content {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        margin: 8% auto;
        padding: 24px;
        border: 1px solid rgba(255,255,255,0.3);
        width: 85%;
        max-width: 560px;
        border-radius: 16px;
        position: relative;
        box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        animation: slideUp 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .modal-close {
        color: #a0aec0;
        position: absolute;
        right: 16px;
        top: 12px;
        font-size: 24px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
    }
    .modal-close:hover,
    .modal-close:focus {
        color: #4a5568;
        background: rgba(0,0,0,0.05);
    }
    .modal-content form {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .modal-content form label {
        margin-bottom: 2px;
        font-weight: 500;
        color: #4a5568;
        font-size: 0.9rem;
    }
    .modal-content form input {
        padding: 10px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        font-size: 0.95rem;
        outline: none;
        transition: all 0.2s ease;
        background: rgba(255,255,255,0.8);
    }
    .modal-content form input:focus {
        border-color: #416d9d;
        box-shadow: 0 0 0 3px rgba(65, 109, 157, 0.12);
        background: #fff;
    }
    .modal-content button[type='submit'] {
        margin-top: 8px;
        background: linear-gradient(135deg, #416d9d, #305580);
        color: #fff;
        border: none;
        padding: 10px 18px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 500;
        transition: all 0.25s ease;
        box-shadow: 0 4px 12px rgba(65, 109, 157, 0.3);
    }
    .modal-content button[type='submit']:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(65, 109, 157, 0.4);
    }
.container {
        max-width: 1280px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        padding: 24px;
        border-radius: 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        border: 1px solid rgba(255,255,255,0.3);
    }
    .admin-header {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-bottom: 24px;
    }
    .admin-header-left {
        flex: 1;
    }
    @media (min-width: 768px) {
        .admin-header {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
        }
    }
    h1 {
        font-size: 1.6rem;
        margin: 0;
        color: #2d3748;
        font-weight: 700;
    }
    .admin-subtitle {
        margin: 4px 0 0;
        color: #718096;
        font-size: 0.88rem;
    }
    
    /* 工具栏图标按钮 */
    .admin-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 16px;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font-size: 0.88rem;
        font-weight: 600;
        color: #fff;
        transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .toolbar-btn svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
    }
    .toolbar-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.2);
        filter: brightness(1.1);
    }
    .toolbar-btn:active {
        transform: translateY(0);
    }
    .toolbar-btn-add {
        background: linear-gradient(135deg, #48bb78, #38a169);
    }
    .toolbar-btn-import {
        background: linear-gradient(135deg, #416d9d, #305580);
    }
    .toolbar-btn-export {
        background: linear-gradient(135deg, #38b2ac, #319795);
    }
    .toolbar-btn-logout {
        background: linear-gradient(135deg, #fc8181, #e53e3e);
    }
    @media (max-width: 480px) {
        .toolbar-btn span {
            display: none;
        }
        .toolbar-btn {
            padding: 10px 12px;
            border-radius: 10px;
        }
        .toolbar-btn svg {
            width: 20px;
            height: 20px;
        }
        .container {
            padding: 16px;
            border-radius: 16px;
        }
    }

    #message {
        border-radius: 12px;
        padding: 12px 16px;
        animation: slideDown 0.3s ease;
    }

    #config {
        border: 1px solid rgba(226, 232, 240, 0.6);
        border-radius: 16px;
        padding: 12px;
        background: rgba(255,255,255,0.4);
    }
    
    .add-new {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        flex-wrap: wrap;
        padding: 16px;
        background: rgba(247, 250, 252, 0.8);
        border-radius: 14px;
        border: 1px solid rgba(226, 232, 240, 0.6);
        animation: slideDown 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    @keyframes slideDown {
        from { opacity: 0; transform: translateY(-12px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .add-new > input {
        flex: 1 1 140px;
        min-width: 140px;
        border-radius: 10px !important;
        padding: 10px 14px !important;
    }
    .add-new > button {
        flex-basis: 100%;
        background: linear-gradient(135deg, #48bb78, #38a169) !important;
        border-radius: 10px !important;
        font-weight: 600 !important;
        box-shadow: 0 2px 8px rgba(72, 187, 120, 0.3);
        transition: all 0.25s ease !important;
    }
    .add-new > button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(72, 187, 120, 0.4);
        filter: brightness(1.05);
    }
    @media (min-width: 768px) {
        .add-new > button {
            flex-basis: auto;
        }
    }
 input[type="text"], input[type="number"] {
        padding: 10px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        font-size: 0.95rem;
        outline: none;
        margin-bottom: 5px;
        transition: all 0.2s ease;
        background: rgba(255,255,255,0.8);
    }
    input[type="text"]:focus, input[type="number"]:focus {
        border-color: #416d9d;
        box-shadow: 0 0 0 3px rgba(65, 109, 157, 0.12);
        background: #fff;
    }
    button {
        background: linear-gradient(135deg, #416d9d, #305580);
        color: #fff;
        border: none;
        padding: 9px 16px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        transition: all 0.25s ease;
    }
    button:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
    }
    .table-wrapper {
        overflow-x: auto;
        border-radius: 12px;
    }
    table {
        width: 100%;
        min-width: 800px;
        border-collapse: separate;
        border-spacing: 0;
        margin-bottom: 16px;
        border-radius: 12px;
        overflow: hidden;
    }
    th, td {
        border-bottom: 1px solid rgba(226, 232, 240, 0.6);
        padding: 12px 14px;
        text-align: left;
        color: #4a5568;
    }
    th {
        background: rgba(65, 109, 157, 0.08);
        font-weight: 600;
        color: #4a5568;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }
    tr {
        transition: background 0.15s ease;
    }
    tbody tr:hover {
        background: rgba(65, 109, 157, 0.04);
    }
    tr:nth-child(even) {
        background: rgba(247, 250, 252, 0.5);
    }
    tr:nth-child(even):hover {
        background: rgba(65, 109, 157, 0.06);
    }
    .pagination {
        text-align: center;
        margin-top: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }
    .pagination button {
        margin: 0;
        background: rgba(255,255,255,0.8);
        color: #4a5568;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 8px 16px;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .pagination button:hover:not(:disabled) {
        background: #fff;
        border-color: #cbd5e0;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }
    .pagination button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        transform: none !important;
    }
    .pagination span {
        color: #4a5568;
        font-size: 0.9rem;
    }
    
    .success {
        background: linear-gradient(135deg, #48bb78, #38a169);
        color: #fff;
        box-shadow: 0 4px 12px rgba(72, 187, 120, 0.3);
    }
    .error {
        background: linear-gradient(135deg, #fc8181, #e53e3e);
        color: #fff;
        box-shadow: 0 4px 12px rgba(229, 62, 62, 0.3);
    }
    
    /* 分类侧边栏布局 */
    .config-layout {
        display: flex;
        gap: 16px;
        min-height: 400px;
    }
    .category-sidebar {
        flex: 0 0 220px;
        background: rgba(255,255,255,0.5);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 14px;
        padding: 14px;
        border: 1px solid rgba(226, 232, 240, 0.5);
        overflow-y: auto;
        max-height: 600px;
    }
    .category-sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(226, 232, 240, 0.5);
    }
    .category-sidebar-header h3 {
        margin: 0;
        font-size: 0.95rem;
        color: #2d3748;
        font-weight: 600;
    }
    #refreshCategorySidebar {
        background: none;
        border: none;
        font-size: 1.1rem;
        cursor: pointer;
        color: #a0aec0;
        padding: 4px 8px;
        border-radius: 8px;
        transition: all 0.2s;
        width: auto;
    }
    #refreshCategorySidebar:hover {
        background: rgba(65, 109, 157, 0.1);
        color: #416d9d;
        transform: rotate(180deg);
    }
    .category-sidebar-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .category-sidebar-item {
        padding: 7px 10px;
        cursor: pointer;
        border-radius: 10px;
        margin-bottom: 2px;
        font-size: 0.87rem;
        color: #4a5568;
        transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
        display: flex;
        align-items: center;
        gap: 4px;
        position: relative;
        user-select: none;
    }
    .category-sidebar-item:hover {
        background: rgba(65, 109, 157, 0.08);
        color: #416d9d;
        padding-left: 14px;
    }
    .category-sidebar-item.active {
        background: linear-gradient(135deg, #416d9d, #305580);
        color: #fff;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(65, 109, 157, 0.3);
    }
    .category-sidebar-item .cat-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        font-size: 0.6rem;
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
        color: #a0aec0;
    }
    .category-sidebar-item .cat-toggle.expanded {
        transform: rotate(90deg);
    }
    .category-sidebar-item.active .cat-toggle {
        color: rgba(255,255,255,0.8);
    }
    .category-sidebar-item .cat-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .category-sidebar-item .cat-count {
        font-size: 0.7rem;
        background: rgba(0,0,0,0.06);
        padding: 1px 7px;
        border-radius: 10px;
        flex-shrink: 0;
        font-weight: 500;
    }
    .category-sidebar-item.active .cat-count {
        background: rgba(255,255,255,0.25);
    }
    .category-sidebar-item .cat-sort-actions {
        display: none;
        gap: 2px;
        flex-shrink: 0;
        margin-left: 2px;
    }
    .category-sidebar-item:hover .cat-sort-actions {
        display: inline-flex;
    }
    .category-sidebar-item .cat-sort-btn {
        width: 20px;
        height: 20px;
        border: none;
        background: rgba(0,0,0,0.05);
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.55rem;
        color: #718096;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
        transition: all 0.15s ease;
    }
    .category-sidebar-item .cat-sort-btn:hover:not(.disabled) {
        background: linear-gradient(135deg, #416d9d, #305580);
        color: #fff;
        transform: scale(1.1);
    }
    .category-sidebar-item .cat-sort-btn.disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
    .category-sidebar-item.active .cat-sort-btn {
        background: rgba(255,255,255,0.2);
        color: #fff;
    }
    .category-sidebar-item.active .cat-sort-btn:hover:not(.disabled) {
        background: rgba(255,255,255,0.35);
    }
    .category-sidebar-children {
        list-style: none;
        padding: 0;
        margin: 0;
        overflow: hidden;
    }
    .category-sidebar-children.collapsed {
        display: none;
    }
    .config-main {
        flex: 1;
        min-width: 0;
    }
    /* 操作按钮 */
    .actions {
        display: flex;
        gap: 6px;
    }
    .actions button {
        padding: 6px 12px;
        font-size: 0.8rem;
        border-radius: 8px;
        font-weight: 500;
    }
    .edit-btn {
        background: linear-gradient(135deg, #38b2ac, #319795) !important;
        box-shadow: 0 2px 6px rgba(56, 178, 172, 0.25);
    }
    .del-btn {
        background: linear-gradient(135deg, #fc8181, #e53e3e) !important;
        box-shadow: 0 2px 6px rgba(229, 62, 62, 0.25);
    }
    /* 搜索框 */
    .search-input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 12px !important;
        background: rgba(255,255,255,0.7) !important;
    }
    @media (max-width: 768px) {
        .config-layout {
            flex-direction: column;
        }
        .category-sidebar {
            flex: none;
            max-height: 200px;
        }
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
          const addNewForm = document.getElementById('addNewForm');
          const addSubmitBtn = document.getElementById('addSubmitBtn');
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
          const refreshCategorySidebarBtn = document.getElementById('refreshCategorySidebar');
          let selectedCategory = '';
          let categoryTree = [];
          let flatCategories = [];
          let totalSitesCount = 0;
          let expandedCategories = new Set(); // 记录展开的分类ID

          function loadCategorySidebar() {
            if (!categorySidebarList) return;
            fetch('/api/categories')
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

          function updateCatelogDatalist() {
            // 更新添加表单和编辑表单中可选的分类列表
            let dataList = document.getElementById('catOptions');
            if (!dataList) {
              dataList = document.createElement('datalist');
              dataList.id = 'catOptions';
              document.body.appendChild(dataList);
            }
            dataList.innerHTML = flatCategories.map(c => '<option value="' + escapeHTML(c.path) + '">' + escapeHTML(c.path) + '</option>').join('');
            if (addCatelog) {
              addCatelog.setAttribute('list', 'catOptions');
            }
            const editCatelog = document.getElementById('editCatelog');
            if (editCatelog) {
              editCatelog.setAttribute('list', 'catOptions');
            }
          }

          function selectCategory(category) {
            selectedCategory = category;
            renderCategorySidebar();
            currentPage = 1;
            if (category === '') {
              fetchConfigs(1, currentSearchKeyword);
            } else {
              fetchConfigsByCategory(category, 1);
            }
          }

          function fetchConfigsByCategory(category, page) {
            let url = '/api/config?page=' + page + '&pageSize=' + pageSize + '&catalog=' + encodeURIComponent(category);
            if (currentSearchKeyword) {
              url = '/api/config?page=' + page + '&pageSize=' + pageSize + '&catalog=' + encodeURIComponent(category) + '&keyword=' + encodeURIComponent(currentSearchKeyword);
            }
            fetch(url)
              .then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  totalItems = data.total;
                  currentPage = data.page;
                  totalPagesSpan.innerText = Math.ceil(totalItems / pageSize);
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

          if (refreshCategorySidebarBtn) {
            refreshCategorySidebarBtn.addEventListener('click', () => {
              loadCategorySidebar();
            });
          }

          // 修改 fetchConfigs 以支持分类过滤
          fetchConfigs = function(page, keyword) {
            page = page || currentPage;
            keyword = keyword !== undefined ? keyword : currentSearchKeyword;
            let url = '/api/config?page=' + page + '&pageSize=' + pageSize;
            if (selectedCategory) {
              url += '&catalog=' + encodeURIComponent(selectedCategory);
            }
            if (keyword) {
              url += '&keyword=' + encodeURIComponent(keyword);
            }
            fetch(url)
              .then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  totalItems = data.total;
                  currentPage = data.page;
                  totalPagesSpan.innerText = Math.ceil(totalItems / pageSize);
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
          };

          
          // 添加搜索框
          const searchInput = document.createElement('input');
          searchInput.type = 'text';
          searchInput.placeholder = '搜索书签(名称，URL，分类，描述)';
          searchInput.id = 'searchInput';
          searchInput.className = 'search-input';
          searchInput.style.marginBottom = '12px';
          const configMain = document.querySelector('.config-main');
          if (configMain) {
            const tableWrapper = configMain.querySelector('.table-wrapper');
            if (tableWrapper) {
              configMain.insertBefore(searchInput, tableWrapper);
            } else {
              configMain.appendChild(searchInput);
            }
          }
          
          
          let currentPage = 1;
          let pageSize = 10;
          let totalItems = 0;
          let allConfigs = []; // 保存所有配置数据
          let currentSearchKeyword = ''; // 保存当前搜索关键词
          
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
                <label for="editCatelog">分类（用/分隔多级）:</label>
                <input type="text" id="editCatelog" placeholder="如：工具/开发/前端" required><br>
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
            const catelog = document.getElementById('editCatelog').value;
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
          
          
          function fetchConfigs(page = currentPage, keyword = currentSearchKeyword) {
              let url = \`/api/config?page=\${page}&pageSize=\${pageSize}\`;
              if(keyword) {
                  url = \`/api/config?page=\${page}&pageSize=\${pageSize}&keyword=\${keyword}\`
              }
              fetch(url)
                  .then(res => res.json())
                  .then(data => {
                      if (data.code === 200) {
                          totalItems = data.total;
                          currentPage = data.page;
                                                 totalPagesSpan.innerText = Math.ceil(totalItems / pageSize);
                          currentPageSpan.innerText = currentPage;
                          allConfigs = data.data; // 保存所有数据
                          renderConfig(allConfigs);
                          updatePaginationButtons();
                      } else {
                          showMessage(data.message, 'error');
                      }
                  }).catch(err => {
                  showMessage('网络错误', 'error');
              })
          }
          function renderConfig(configs) {
          configTableBody.innerHTML = '';
           if (configs.length === 0) {
                configTableBody.innerHTML = '<tr><td colspan="7">没有配置数据</td></tr>';
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
                  <td>\${safeName}</td>
                  <td>\${urlCell}</td>
                  <td>\${logoCell}</td>
                  <td>\${descCell}</td>
                  <td>\${catelogCell}</td>
				 <td>\${sortValue}</td>
                  <td class="actions">
                    <button class="edit-btn" data-id="\${config.id}">编辑</button>
                    <button class="del-btn" data-id="\${config.id}">删除</button>
                  </td>
               \`;
              configTableBody.appendChild(row);
          });
            bindActionEvents();
          }
          
          function bindActionEvents() {
           document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const id = this.dataset.id;
                    handleEdit(id);
                })
           });
          
          document.querySelectorAll('.del-btn').forEach(btn => {
               btn.addEventListener('click', function() {
                  const id = this.dataset.id;
                   handleDelete(id)
               })
          })
         }

    // [优化] 点击编辑时，获取并填充排序字段
          function handleEdit(id) {
            fetch(\`/api/config?page=1&pageSize=1000\`) // A simple way to get all configs to find the one to edit
            .then(res => res.json())
            .then(data => {
                const configToEdit = data.data.find(c => c.id == id);
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
                document.getElementById('editSortOrder').value = configToEdit.sort_order === 9999 ? '' : configToEdit.sort_order; // [新增]
                editModal.style.display = 'block';
            });
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
          
          // 添加按钮：切换表单显示/隐藏
          addBtn.addEventListener('click', () => {
            const isHidden = addNewForm.classList.contains('form-collapsed');
            if (isHidden) {
              addNewForm.classList.remove('form-collapsed');
              addNewForm.style.display = '';
              requestAnimationFrame(() => {
                addName.focus();
              });
            } else {
              addNewForm.classList.add('form-collapsed');
              addNewForm.style.display = 'none';
            }
          });

          // 提交添加
          function submitAddBookmark() {
            const name = addName.value;
            const url = addUrl.value;
            const logo = addLogo.value;
            const desc = addDesc.value;
            const catelog = addCatelog.value;
            const sort_order = addSortOrder.value;
            if(!name || !url || !catelog) {
              showMessage('名称,URL,分类 必填', 'error');
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
                addName.value = '';
                addUrl.value = '';
                addLogo.value = '';
                addDesc.value = '';
                addCatelog.value = '';
                addSortOrder.value = '';
                addNewForm.classList.add('form-collapsed');
                addNewForm.style.display = 'none';
                fetchConfigs();
                loadCategorySidebar();
              } else {
                showMessage(data.message, 'error');
              }
            }).catch(err => {
              showMessage('网络错误', 'error');
            })
          }
          addSubmitBtn.addEventListener('click', submitAddBookmark);
          
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
              fetchConfigs(currentPage,currentSearchKeyword);
          });
          
          
          fetchConfigs();
          loadCategorySidebar();
          
          // 退出登录功能
          const logoutBtn = document.getElementById('logoutBtn');
          if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
              if (!confirm('确定要退出登录吗？')) return;
              
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
            });
          }
          `
    }
    return fileContents[filePath]
    },
  
    async renderAdminPage(env) {
    let html = await this.getFileContent('admin.html');
    const faviconApi = getIconApiUrl(env);
    html = html.replace('const faviconApi = \'https://toolb.cn/favicon/{domain}\';', `const faviconApi = '${faviconApi}';`);
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
          *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
          }
          html, body {
            height: 100%;
            font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #fdf8f3 0%, #f3f5f9 40%, #e8edf5 100%);
            background-attachment: fixed;
            padding: 1rem;
            position: relative;
            overflow: hidden;
          }
          body::before {
            content: '';
            position: absolute;
            width: 500px;
            height: 500px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(65, 109, 157, 0.08) 0%, transparent 70%);
            top: -100px;
            right: -100px;
            pointer-events: none;
          }
          body::after {
            content: '';
            position: absolute;
            width: 400px;
            height: 400px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(234, 160, 94, 0.08) 0%, transparent 70%);
            bottom: -80px;
            left: -80px;
            pointer-events: none;
          }
          .login-container {
            background: rgba(255, 255, 255, 0.88);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            padding: 2.5rem 2rem;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0,0,0,0.05);
            border: 1px solid rgba(255,255,255,0.4);
            width: 100%;
            max-width: 380px;
            animation: slideUpFade 0.5s cubic-bezier(0.25, 0.8, 0.25, 1);
            position: relative;
            z-index: 1;
          }
          @keyframes slideUpFade {
            from { opacity: 0; transform: translateY(24px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .login-icon {
            width: 56px;
            height: 56px;
            margin: 0 auto 1.25rem;
            background: linear-gradient(135deg, #416d9d, #305580);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(65, 109, 157, 0.3);
          }
          .login-icon svg {
            width: 28px;
            height: 28px;
            color: white;
          }
          .login-title {
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            margin: 0 0 0.5rem 0;
            color: #2d3748;
          }
          .login-subtitle {
            text-align: center;
            color: #718096;
            font-size: 0.88rem;
            margin-bottom: 1.75rem;
          }
          .form-group {
            margin-bottom: 1rem;
          }
          label {
            display: block;
            margin-bottom: 0.4rem;
            font-weight: 500;
            color: #4a5568;
            font-size: 0.88rem;
          }
          input[type="text"], input[type="password"] {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 1.5px solid #e2e8f0;
            border-radius: 12px;
            font-size: 0.95rem;
            transition: all 0.2s ease;
            background: rgba(255,255,255,0.7);
            outline: none;
          }
          input[type="text"]:focus, input[type="password"]:focus {
            border-color: #416d9d;
            box-shadow: 0 0 0 3px rgba(65, 109, 157, 0.12);
            background: #fff;
          }
          button {
            width: 100%;
            padding: 0.8rem;
            background: linear-gradient(135deg, #416d9d, #305580);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
            box-shadow: 0 4px 14px rgba(65, 109, 157, 0.35);
            margin-top: 0.5rem;
          }
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(65, 109, 157, 0.45);
            filter: brightness(1.05);
          }
          button:active {
            transform: translateY(0) scale(0.98);
          }
          .error-message {
            color: #e53e3e;
            font-size: 0.82rem;
            margin-top: 0.75rem;
            text-align: center;
            display: none;
            background: rgba(229, 62, 62, 0.08);
            padding: 0.5rem;
            border-radius: 8px;
          }
          .back-link {
            display: block;
            text-align: center;
            margin-top: 1.25rem;
            color: #718096;
            text-decoration: none;
            font-size: 0.85rem;
            transition: color 0.2s;
          }
          .back-link:hover {
            color: #416d9d;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="login-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 class="login-title">管理员登录</h1>
          <p class="login-subtitle">请输入账号密码以访问后台</p>
          <form method="post" action="/admin" novalidate>
            <div class="form-group">
              <label for="username">用户名</label>
              <input type="text" id="username" name="name" required autocomplete="username" placeholder="请输入用户名">
            </div>
            <div class="form-group">
              <label for="password">密码</label>
              <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="请输入密码">
            </div>
            ${hasError ? `<div class="error-message" style="display:block;">${safeMessage}</div>` : `<div class="error-message">用户名或密码错误</div>`}
            <button type="submit">登 录</button>
          </form>
          <a href="/" class="back-link">← 返回首页</a>
        </div>
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
    try {
      const { results } = await env.NAV_DB.prepare('SELECT * FROM sites ORDER BY sort_order ASC, create_time DESC').all();
      sites = results;
    } catch (e) {
      return new Response(`Failed to fetch data: ${e.message}`, { status: 500 });
    }

    if (!sites || sites.length === 0) {
      return new Response('No site configuration found.', { status: 404 });
    }

    const totalSites = sites.length;

    // 先计算每个分类的书签数量
    const siteCountMap = new Map();
    for (const site of sites) {
      const catName = (site.catelog || '').trim();
      if (!catName) continue;
      siteCountMap.set(catName, (siteCountMap.get(catName) || 0) + 1);
    }

    // 从 categories 表获取分类树
    let categoryTree = [];
    let flatCats = [];
    try {
      // 先清理孤儿分类
      await cleanupOrphanCategories(env);

      const { results: catRows } = await env.NAV_DB.prepare(
        'SELECT id, name, parent_id, path, sort_order FROM categories ORDER BY sort_order ASC, id ASC'
      ).all();
      
      const catsWithCount = catRows.map(c => ({
        ...c,
        site_count: siteCountMap.get(c.path) || 0
      }));
      
      categoryTree = buildCategoryTree(catsWithCount, 0);
      // 递归汇总子分类计数到父分类
      rollupCategoryCounts(categoryTree);
      // 剪枝：过滤空分类
      categoryTree = pruneEmptyCategories(categoryTree);
      flatCats = flattenCategoryTree(categoryTree);
    } catch (e) {
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
        const childrenId = 'cat-children-' + safeCat.replace(/[^a-zA-Z0-9]/g, '_');
        
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
    const submissionEnabled = isSubmissionEnabled(env);
    const faviconApi = getIconApiUrl(env);

    // 优化后的 HTML
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>琪舟阁</title>
      <link rel="icon" href="https://img.520jacky.dpdns.org/i/2026/03/06/057561.png" type="image/webp"/>
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
                  500: '#416d9d',
                  600: '#305580',
                  700: '#254267',
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
        * {
          -webkit-tap-highlight-color: transparent;
        }
        html {
          scroll-behavior: smooth;
        }
        body {
          background: linear-gradient(135deg, #fdf8f3 0%, #f3f5f9 40%, #e8edf5 100%) !important;
          background-attachment: fixed;
          min-height: 100vh;
        }
        /* 自定义滚动条 */
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(108, 143, 186, 0.3);
          border-radius: 10px;
          transition: background 0.3s;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(65, 109, 157, 0.5);
        }
        
        /* 毛玻璃侧边栏 */
        .sidebar {
          background: rgba(255, 255, 255, 0.72) !important;
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-right: 1px solid rgba(255, 255, 255, 0.5) !important;
          box-shadow: 4px 0 24px rgba(37, 66, 103, 0.06);
        }
        
        /* 毛玻璃浮动按钮 */
        .glass-btn {
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 4px 16px rgba(37, 66, 103, 0.08);
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .glass-btn:hover {
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 6px 20px rgba(37, 66, 103, 0.12);
          transform: translateY(-1px);
        }
        
        /* 卡片悬停效果 - 增强版 */
        .site-card {
          background: rgba(255, 255, 255, 0.75) !important;
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.6) !important;
          transition: all 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
          opacity: 0;
          transform: translateY(16px);
          animation: cardFadeIn 0.5s ease forwards;
        }
        .site-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 32px rgba(37, 66, 103, 0.12), 0 2px 8px rgba(37, 66, 103, 0.06);
          border-color: rgba(195, 208, 227, 0.5) !important;
          background: rgba(255, 255, 255, 0.88) !important;
        }
        @keyframes cardFadeIn {
          to { opacity: 1; transform: translateY(0); }
        }
        
        /* 搜索框毛玻璃 */
        .glass-search {
          background: rgba(255, 255, 255, 0.6) !important;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(225, 231, 241, 0.8) !important;
          transition: all 0.3s ease;
        }
        .glass-search:focus {
          background: rgba(255, 255, 255, 0.9) !important;
          border-color: rgba(108, 143, 186, 0.5) !important;
          box-shadow: 0 0 0 3px rgba(108, 143, 186, 0.1);
        }
        
        /* 分类链接平滑过渡 */
        .category-link {
          transition: all 0.2s ease;
          position: relative;
        }
        .category-link:hover {
          padding-left: 16px !important;
        }
        .category-link.active {
          background: linear-gradient(135deg, rgba(65, 109, 157, 0.1), rgba(65, 109, 157, 0.05)) !important;
        }
        
        /* 页脚毛玻璃 */
        .glass-footer {
          background: rgba(255, 255, 255, 0.5) !important;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-top: 1px solid rgba(255, 255, 255, 0.5) !important;
        }
        
        /* 返回顶部按钮 */
        .back-top-btn {
          background: rgba(60, 151, 109, 0.9) !important;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 4px 20px rgba(60, 151, 109, 0.3);
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .back-top-btn:hover {
          background: rgba(46, 119, 85, 0.95) !important;
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(60, 151, 109, 0.4);
        }
        .back-top-btn.visible {
          opacity: 1 !important;
          visibility: visible !important;
        }
        
        /* 移动端遮罩层平滑 */
        .mobile-overlay {
          transition: opacity 0.3s ease, visibility 0.3s ease;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        
        /* 预览模态框增强 */
        .preview-modal {
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .preview-modal.visible {
          opacity: 1 !important;
          visibility: visible !important;
        }
        
        /* 头部渐变增强 */
        .hero-header {
          background: linear-gradient(135deg, #254267 0%, #305580 50%, #416d9d 100%) !important;
          position: relative;
          overflow: hidden;
        }
        .hero-header::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -20%;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(210, 170, 121, 0.15) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-header::after {
          content: '';
          position: absolute;
          bottom: -30%;
          left: -10%;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(97, 180, 138, 0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        
        /* 毛玻璃统计卡片 */
        .glass-stats {
          background: rgba(255, 255, 255, 0.12) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        /* 分类展开按钮平滑 */
        .cat-expand-btn {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease, background 0.2s ease;
        }
        
        /* 复制成功提示 */
        .copy-tip {
          animation: copyTipFade 1.8s ease forwards;
        }
        @keyframes copyTipFade {
          0% { opacity: 0; transform: translateY(8px); }
          15% { opacity: 1; transform: translateY(0); }
          75% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-6px); }
        }
        
        /* 复制成功提示动画 */
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateY(10px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px); }
        }
        .copy-success-animation {
          animation: fadeInOut 2s ease forwards;
        }
        
        /* 分类展开/折叠 */
        .cat-row {
          display: flex;
          align-items: center;
        }
        .cat-expand-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 28px;
          border: none;
          background: transparent;
          cursor: pointer;
          color: #9ca3af;
          padding: 0;
          flex-shrink: 0;
          border-radius: 4px;
          transition: transform 0.15s, color 0.15s, background 0.15s;
        }
        .cat-expand-btn:hover {
          color: #6c63ff;
          background: rgba(108,99,255,0.08);
        }
        .cat-expand-btn.expanded {
          transform: rotate(90deg);
        }
        .cat-expand-placeholder {
          display: inline-block;
          width: 20px;
          height: 28px;
          flex-shrink: 0;
        }
        .cat-children {
          overflow: hidden;
          max-height: 5000px;
          transition: max-height 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.25s ease;
          opacity: 1;
        }
        .cat-children.collapsed {
          max-height: 0;
          opacity: 0;
        }
        
        /* 移动端侧边栏 */
        @media (max-width: 768px) {
          .mobile-sidebar {
            transform: translateX(-100%);
            transition: transform 0.3s ease;
          }
          .mobile-sidebar.open {
            transform: translateX(0);
          }
          .mobile-overlay {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
          }
          .mobile-overlay.open {
            opacity: 1;
            pointer-events: auto;
          }
        }
        
        /* 多行文本截断 */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        /* 侧边栏控制 */
        #sidebar-toggle {
          display: none;
        }
        
        @media (min-width: 769px) {
          #sidebar-toggle:checked ~ .sidebar {
            margin-left: -16rem;
          }
          #sidebar-toggle:checked ~ .main-content {
            margin-left: 0;
          }
        }
        
        /* 性能优化样式 */
        .logo-img {
          will-change: opacity;
        }
        
        /* 预连接优化 - 减少 DNS 查找延迟 */
        body::before {
          content: "";
          display: none;
          /* 预连接常用的图标 API（如果有） */
        }
      </style>
    </head>
    <body class="bg-secondary-50 font-sans text-gray-800">
      <!-- 侧边栏开关 -->
      <input type="checkbox" id="sidebar-toggle" class="hidden">
      
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
            <h2 class="text-2xl font-bold text-primary-600 tracking-tight">琪舟阁</h2>
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
          
          <a href="https://github.com/bayueqi/ZQ-NAV" target="_blank" class="mt-4 flex items-center px-4 py-2 text-gray-600 hover:text-primary-500 transition duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              项目地址
            </a>

            <a href="/admin" target="_blank" class="mt-4 flex items-center px-4 py-2 text-gray-600 hover:text-primary-500 transition duration-300">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              后台管理
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
              <span class="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-secondary-200/90 border border-white/10">
                生如夏花之绚烂，死如秋叶之静美。
              </span>
              <h1 class="mt-4 text-3xl md:text-4xl font-semibold tracking-tight drop-shadow-sm">琪舟阁</h1>
              <p class="mt-3 text-sm md:text-base text-secondary-100/90 leading-relaxed">
                - 指路人，亦是摘星人。
              </p>
            </div>
            <div class="w-full md:w-auto flex justify-center md:justify-end">
              <div class="glass-stats rounded-2xl px-6 py-5 text-left md:text-right">
                <p class="text-xs uppercase tracking-[0.28em] text-secondary-100/70">Current Overview</p>
                <p class="mt-3 text-2xl font-semibold">${totalSites}</p>
                <p class="text-sm text-secondary-100/85">条书签 · ${catalogs.length} 个分类</p>
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
          <div class="rounded-2xl border border-white/40 bg-white/40 backdrop-blur-md p-4 sm:p-6 shadow-sm">
            <div id="sitesGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              ${currentSites.map((site, idx) => {
              const rawName = site.name || '未命名';
              const rawCatalog = site.catelog || '未分类';
              const rawDesc = site.desc || '暂无描述';
              const normalizedUrl = sanitizeUrl(site.url);
              const hrefValue = escapeHTML(normalizedUrl || '#');
              const displayUrlText = normalizedUrl || site.url || '';
              const safeDisplayUrl = displayUrlText ? escapeHTML(displayUrlText) : '未提供链接';
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
                  finalIconUrl = escapeHTML(getIconApiUrl(env).replace('{domain}', domain));
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
                <div class="site-card group rounded-xl overflow-hidden" style="animation-delay:${Math.min(idx * 50, 600)}ms" data-id="${site.id}" data-name="${safeDataName}" data-url="${dataUrlAttr}" data-catalog="${safeDataCatalog}" data-desc="${safeDesc}">
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
                    
                    <p class="mt-2 text-sm text-gray-600 leading-relaxed line-clamp-2" title="${safeDesc}">${safeDesc}</p>
                    
                    <div class="mt-3 flex items-center justify-between">
                      <a href="${hrefValue}" ${hasValidUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} class="text-xs text-primary-600 truncate max-w-[140px] hover:underline" title="${safeDisplayUrl}">${safeDisplayUrl}</a>
                      <button class="copy-btn relative flex items-center px-2 py-1 ${hasValidUrl ? 'bg-accent-100 text-accent-700 hover:bg-accent-200' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} rounded-full text-xs font-medium transition-colors" data-url="${dataUrlAttr}" ${hasValidUrl ? '' : 'disabled'}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        复制
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
            <p class="text-gray-500">© ${new Date().getFullYear()} 琪舟阁 | 愿你在此找到方向</p>
            <div class="mt-4 flex justify-center space-x-6">
              <a href="https://github.com/bayueqi" target="_blank" class="text-gray-400 hover:text-primary-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </a>
            </div>
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
  
  // 确保分类表存在并迁移数据
  try {
    await ensureCategoriesTable(env);
  } catch(e) {
    console.error('ensureCategoriesTable error:', e);
  }
  
  if (url.pathname.startsWith('/api')) {
    return api.handleRequest(request, env, ctx);
  } else if (url.pathname === '/admin' || url.pathname.startsWith('/static')) {
    return admin.handleRequest(request, env, ctx);
  } else {
    return handleRequest(request, env, ctx);
  }
},
};
