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
 * 渲染单个网站卡片（优化版）
 */
function renderSiteCard(site) {
  const logoHTML = getRandomSVG();

  return `
    <div class="channel-card" data-id="${site.id}">
      <div class="channel-number">${site.id}</div>
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
                        return await this.createConfig(request, env, ctx);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
            if (path === '/config/submit' && method === 'POST') {
              return await this.submitConfig(request, env, ctx);
           }
            if (path === `/config/${id}` && /^\d+$/.test(id)) {
                switch (method) {
                    case 'PUT':
                        return await this.updateConfig(request, env, ctx, id);
                    case 'DELETE':
                        return await this.deleteConfig(request, env, ctx, id);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
              if (path.startsWith('/pending/') && /^\d+$/.test(id)) {
                switch (method) {
                    case 'PUT':
                        return await this.approvePendingConfig(request, env, ctx, id);
                    case 'DELETE':
                        return await this.rejectPendingConfig(request, env, ctx, id);
                    default:
                        return this.errorResponse('Method Not Allowed', 405)
                }
            }
            if (path === '/config/import' && method === 'POST') {
                return await this.importConfig(request, env, ctx);
            }
            if (path === '/config/export' && method === 'GET') {
                return await this.exportConfig(request, env, ctx);
            }
            if (path === '/pending' && method === 'GET') {
              return await this.getPendingConfig(request, env, ctx, url);
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
                      query = `SELECT * FROM sites WHERE catelog = ? ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                      countQuery = `SELECT COUNT(*) as total FROM sites WHERE catelog = ?`
                      queryBindParams = [catalog, pageSize, offset];
                      countQueryParams = [catalog];
                  }
  
                  if (keyword) {
                      const likeKeyword = `%${keyword}%`;
                      query = `SELECT * FROM sites WHERE name LIKE ? OR url LIKE ? OR catelog LIKE ? ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                      countQuery = `SELECT COUNT(*) as total FROM sites WHERE name LIKE ? OR url LIKE ? OR catelog LIKE ?`;
                      queryBindParams = [likeKeyword, likeKeyword, likeKeyword, pageSize, offset];
                      countQueryParams = [likeKeyword, likeKeyword, likeKeyword];
  
                      if (catalog) {
                          query = `SELECT * FROM sites WHERE catelog = ? AND (name LIKE ? OR url LIKE ? OR catelog LIKE ?) ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
                          countQuery = `SELECT COUNT(*) as total FROM sites WHERE catelog = ? AND (name LIKE ? OR url LIKE ? OR catelog LIKE ?)`;
                          queryBindParams = [catalog, likeKeyword, likeKeyword, likeKeyword, pageSize, offset];
                          countQueryParams = [catalog, likeKeyword, likeKeyword, likeKeyword];
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
                        SELECT * FROM pending_sites ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?
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
                // [修复] 批准时复用主列表排序逻辑
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
                // [新增] 删除后自动重新排序
                const { results } = await env.NAV_DB.prepare('SELECT id FROM pending_sites ORDER BY sort_order ASC, create_time DESC').all();
                let updates = [];
                for (let i = 0; i < results.length; i++) {
                    updates.push(env.NAV_DB.prepare('UPDATE pending_sites SET sort_order = ? WHERE id = ?').bind(i + 1, results[i].id));
                }
                if (updates.length > 0) {
                    await env.NAV_DB.batch(updates);
                }
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
              const config = await request.json();
              const { name, url, desc, logo, catelog, sort_order } = config;
  
              if (!name || !url || !catelog ) {
                  return this.errorResponse('Name, URL and Catelog are required', 400);
              }
              await env.NAV_DB.prepare(`
                  INSERT INTO pending_sites (name, url, desc, logo, catelog, sort_order)
                  VALUES (?, ?, ?, ?, ?, ?)
            `).bind(name, url, desc, logo, catelog, sort_order || 9999).run();
  
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
              //- [新增] 从请求体中获取 sort_order
              const { name, url, desc, catelog, sort_order } = config;
  
              if (!name || !url || !catelog ) {
                  return this.errorResponse('Name, URL and Catelog are required', 400);
              }
              
              // [修改] 新的排序逻辑
              let targetSortOrder = 1;
              if (!sort_order || sort_order === '') {
                  // 如果没填写排序号，自动分配最大序号+1
                  const maxSortResult = await env.NAV_DB.prepare('SELECT MAX(sort_order) as max_sort FROM sites WHERE sort_order != 9999').first();
                  targetSortOrder = (maxSortResult && maxSortResult.max_sort ? maxSortResult.max_sort + 1 : 1);
              } else {
                  // 如果填写了排序号，使用填写的值
                  targetSortOrder = parseInt(sort_order) || 1;
              }
              
              // 调整其他网站的排序号，为新网站腾出位置
              await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order != 9999').bind(targetSortOrder).run();
              
              //- [优化] INSERT 语句增加了 sort_order 字段
              const insert = await env.NAV_DB.prepare(`
                    INSERT INTO sites (name, url, desc, catelog, sort_order)
                    VALUES (?, ?, ?, ?, ?)
              `).bind(name, url, desc, catelog, targetSortOrder).run(); // 使用目标排序号
  
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
              const { name, url, desc, logo, catelog, sort_order } = config;
              
              // [修改] 新的排序逻辑
              let targetSortOrder = 9999; // 默认值
              if (sort_order && sort_order !== '') {
                  const inputSortOrder = parseInt(sort_order);
                  if (!isNaN(inputSortOrder)) {
                      targetSortOrder = inputSortOrder;
                  }
              }
              
              // 获取当前项目的排序号
              const currentResult = await env.NAV_DB.prepare('SELECT sort_order FROM sites WHERE id = ?').bind(id).first();
              const currentSortOrder = currentResult ? currentResult.sort_order : 9999;
              
              // 如果排序号发生变化，需要调整其他项目的排序号
              if (targetSortOrder !== currentSortOrder && targetSortOrder !== 9999) {
                  if (targetSortOrder < currentSortOrder) {
                      // 新排序号更小，需要将中间的项目排序号+1
                      await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order < ? AND id != ? AND sort_order != 9999').bind(targetSortOrder, currentSortOrder, id).run();
                  } else {
                      // 新排序号更大，需要将中间的项目排序号-1
                      await env.NAV_DB.prepare('UPDATE sites SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order <= ? AND id != ? AND sort_order != 9999').bind(currentSortOrder, targetSortOrder, id).run();
                  }
              }
  
            const update = await env.NAV_DB.prepare(`
                UPDATE sites
                SET name = ?, url = ?, desc = ?, logo = ?, catelog = ?, sort_order = ?, update_time = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(name, url, desc, logo, catelog, targetSortOrder, id).run();
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
              const del = await env.NAV_DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run();
              // 删除后自动重新排序
              const { results } = await env.NAV_DB.prepare('SELECT id FROM sites ORDER BY sort_order ASC, create_time DESC').all();
              let updates = [];
              for (let i = 0; i < results.length; i++) {
                  updates.push(env.NAV_DB.prepare('UPDATE sites SET sort_order = ? WHERE id = ?').bind(i + 1, results[i].id));
              }
              if (updates.length > 0) {
                  await env.NAV_DB.batch(updates);
              }
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

          // [优化] 智能判断导入的JSON文件格式
          // 1. 如果 jsonData 本身就是数组 (新的、正确的导出格式)
          if (Array.isArray(jsonData)) {
            sitesToImport = jsonData;
          } 
          // 2. 如果 jsonData 是一个对象，且包含一个名为 'data' 的数组 (兼容旧的导出格式)
          else if (jsonData && typeof jsonData === 'object' && Array.isArray(jsonData.data)) {
            sitesToImport = jsonData.data;
          } 
          // 3. 如果两种都不是，则格式无效
          else {
            return this.errorResponse('Invalid JSON data. Must be an array of site configurations, or an object with a "data" key containing the array.', 400);
          }
          
          if (sitesToImport.length === 0) {
            return new Response(JSON.stringify({
              code: 200,
              message: 'Import successful, but no data was found in the file.'
            }), { headers: {'Content-Type': 'application/json'} });
          }

          const insertStatements = sitesToImport.map(item =>
                env.NAV_DB.prepare(`
                        INSERT INTO sites (name, url, desc, catelog, sort_order)
                        VALUES (?, ?, ?, ?, ?)
                  `).bind(item.name || null, item.url || null, item.desc || null, item.catelog || null, item.sort_order || 9999)
            )
  
          // 使用 D1 的 batch 操作，效率更高
          await env.NAV_DB.batch(insertStatements);
  
          return new Response(JSON.stringify({
              code: 201,
              message: `Config imported successfully. ${sitesToImport.length} items added.`
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
          // [优化] 导出的数据将不再被包裹在 {code, data} 对象中
          const { results } = await env.NAV_DB.prepare('SELECT * FROM sites ORDER BY sort_order ASC, create_time DESC').all();
          
          // JSON.stringify 的第二和第三个参数用于"美化"输出的JSON，
          // null 表示不替换任何值，2 表示使用2个空格进行缩进。
          // 这使得导出的文件非常易于阅读和手动编辑。
          const pureJsonData = JSON.stringify(results, null, 2); 

          return new Response(pureJsonData, {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                // 确保浏览器将其作为文件下载
                'Content-Disposition': 'attachment; filename="config.json"'
              }
          });
        } catch(e) {
          return this.errorResponse(`Failed to export config: ${e.message}`, 500)
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
      const params = url.searchParams;
      const name = params.get('name');
      const password = params.get('password');

          // 从KV中获取凭据
    const storedUsername = await env.NAV_AUTH.get("admin_username");
    const storedPassword = await env.NAV_AUTH.get("admin_password");

    if (name === storedUsername && password === storedPassword) {
      return this.renderAdminPage();
    } else if (name || password) {
      return new Response('未授权访问', {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } else {
      return this.renderLoginPage();
    }
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
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body {
          min-height: 100vh;
          background: linear-gradient(120deg, #f8fafc 0%, #e3f0ff 100%);
        }
        .container {
          background: rgba(255,255,255,0.85);
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.10);
          border-radius: 2rem;
          backdrop-filter: blur(12px) saturate(1.2);
          -webkit-backdrop-filter: blur(12px) saturate(1.2);
          margin-top: 40px;
          margin-bottom: 40px;
        }
        h1 {
          background: linear-gradient(90deg, #6c63ff 0%, #4cc9f0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          color: transparent;
          font-size: 2.2rem;
          font-weight: 700;
          margin-bottom: 2rem;
        }
        .tab-buttons .tab-button.active {
          background: linear-gradient(90deg, #e3f0ff 0%, #f8fafc 100%);
          color: #6c63ff;
          font-weight: bold;
        }
        .tab-button {
          border-radius: 1.2rem 1.2rem 0 0;
          margin-right: 8px;
          font-size: 1rem;
        }
        .add-new > input, .add-new > button {
          border-radius: 1.2rem;
        }
        .add-new > button {
          background: linear-gradient(90deg, #6c63ff 0%, #4cc9f0 100%);
          color: #fff;
          font-weight: 600;
          box-shadow: 0 2px 8px rgba(76,201,240,0.10);
        }
        .add-new > button:hover {
          background: linear-gradient(90deg, #4cc9f0 0%, #6c63ff 100%);
        }
        .import-export button {
          border-radius: 1.2rem;
          background: #f0f4fa;
          color: #6c63ff;
          font-weight: 600;
          border: 1px solid #e3e3e3;
        }
        .import-export button:hover {
          background: #e3f0ff;
        }
        .table-wrapper {
          background: rgba(255,255,255,0.7);
          border-radius: 1.2rem;
          box-shadow: 0 2px 8px rgba(76,201,240,0.06);
          padding: 1rem 0.5rem;
        }
        table {
          background: transparent;
          border-radius: 1.2rem;
          table-layout: fixed;
          width: 100%;
        }
        th, td {
          border: none;
          border-bottom: 1px solid #f0f0f0;
          padding: 12px 10px;
          word-break: break-all;
        }
        th {
          background: #f8fafc;
          color: #6c63ff;
          font-weight: 700;
        }
        td.url-cell {
          max-width: 180px;
          min-width: 120px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        td.sort-cell {
          max-width: 60px;
          min-width: 40px;
          text-align: center;
          white-space: nowrap;
        }
        td.logo-cell {
          max-width: 60px;
          min-width: 40px;
          text-align: center;
          white-space: nowrap;
        }
        td.name-cell, td.desc-cell, td.catelog-cell {
          max-width: 120px;
          min-width: 80px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        tr:last-child td {
          border-bottom: none;
        }
        tr {
          transition: background 0.2s;
        }
        tr:hover {
          background: #f0f4fa;
        }
        .actions button, .pagination button {
          border-radius: 1.2rem;
          font-size: 0.95rem;
          /* [优化] 添加硬件加速，减少重绘 */
          transform: translateZ(0);
          will-change: transform;
        }
        .edit-btn {
          background: #4cc9f0;
        }
        .edit-btn:hover {
          background: #6c63ff;
        }
        .del-btn {
          background: #ff6b81;
        }
        .del-btn:hover {
          background: #e63946;
        }
        .pagination button {
          background: #f0f4fa;
          color: #6c63ff;
          border: 1px solid #e3e3e3;
        }
        .pagination button:hover {
          background: #e3f0ff;
        }
        /* [优化] 添加按钮点击反馈 */
        .pagination button:active {
          transform: translateZ(0) scale(0.98);
        }
        /* [优化] 表格行优化 */
        tr {
          transition: background 0.2s;
          /* [优化] 减少重绘 */
          will-change: background-color;
        }
        tr:hover {
          background: #f0f4fa;
        }
        #message.success {
          background: #d1fae5;
          color: #065f46;
        }
        #message.error {
          background: #fee2e2;
          color: #991b1b;
        }
        @media (max-width: 700px) {
          .container {
            border-radius: 0.7rem;
            margin-top: 10px;
            margin-bottom: 10px;
            padding: 8px;
          }
          .table-wrapper {
            border-radius: 0.7rem;
            padding: 0.3rem 0.1rem;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
          <h1>书签管理</h1>
      
          <div class="import-export">
            <input type="file" id="importFile" accept=".json" style="display:none;">
            <button id="importBtn">导入</button>
            <button id="exportBtn">导出</button>
          </div>
      
          <!-- [优化] 添加区域HTML结构，并新增排序输入框 -->
          <div class="add-new">
            <input type="text" id="addName" placeholder="Name" required>
            <input type="text" id="addUrl" placeholder="URL" required>
            <input type="text" id="addDesc" placeholder="Description(optional)">
            <input type="text" id="addLogo" placeholder="Icon URL (optional)">
            <input type="text" id="addCatelog" placeholder="Catelog" required>
            <input type="number" id="addSortOrder" placeholder="排序 (数字小靠前)">
            <button id="addBtn">添加</button>
          </div>
          <div id="message" style="display: none;padding:1rem;border-radius: 0.5rem;margin-bottom: 1rem;"></div>
         <div class="tab-wrapper">
              <div class="tab-buttons">
                 <button class="tab-button active" data-tab="config">书签列表</button>
                 <button class="tab-button" data-tab="pending">待审核列表</button>
              </div>
               <div id="config" class="tab-content active">
                    <div class="table-wrapper">
                        <table id="configTable">
                            <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>URL</th>
                                  <th>Description</th>
                                  <th>Catelog</th>
                                  <th class="sort-th">图标</th>
                                  <th class="sort-th">排序</th>
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
                              <input type="number" id="pageInput" min="1" style="width: 60px; text-align: center; margin: 0 5px;" placeholder="页码">
                              <button id="goToPage">跳转</button>
                              <button id="nextPage" disabled>下一页</button>
                        </div>
                   </div>
                </div>
               <div id="pending" class="tab-content">
                 <div class="table-wrapper">
                   <table id="pendingTable">
                      <thead>
                        <tr>
                             <th>Name</th>
                             <th>URL</th>
                            <th>Description</th>
                            <th>Catelog</th>
                            <th class="sort-th">图标</th>
                            <th class="sort-th">排序</th>
                            <th>Actions</th>
                        </tr>
                        </thead>
                        <tbody id="pendingTableBody">
                       <!-- data render by js -->
                        </tbody>
                    </table>
                     <div class="pagination">
                      <button id="pendingPrevPage" disabled>上一页</button>
                       <span id="pendingCurrentPage">1</span>/<span id="pendingTotalPages">1</span>
                       <input type="number" id="pendingPageInput" min="1" style="width: 60px; text-align: center; margin: 0 5px;" placeholder="页码">
                       <button id="pendingGoToPage">跳转</button>
                      <button id="pendingNextPage" disabled>下一页</button>
                    </div>
                 </div>
               </div>
            </div>
      </div>
      <script src="/static/admin.js"></script>
    </body>
    </html>`,
            'admin.css': `body {
        font-family: 'Noto Sans SC', sans-serif;
        margin: 0;
        padding: 10px; /* [优化] 移动端边距 */
        background-color: #f8f9fa;
        color: #212529;
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
        background-color: rgba(0, 0, 0, 0.35); /* 更柔和的半透明背景 */
        backdrop-filter: blur(2px);
    }
    .modal-content {
        background: rgba(255,255,255,0.92);
        margin: 8% auto;
        padding: 32px 24px 24px 24px;
        border: none;
        width: 95%;
        max-width: 420px;
        border-radius: 1.5rem;
        position: relative;
        box-shadow: 0 8px 32px 0 rgba(76,201,240,0.18);
        backdrop-filter: blur(16px) saturate(1.2);
        -webkit-backdrop-filter: blur(16px) saturate(1.2);
        display: flex;
        flex-direction: column;
        align-items: center;
        animation: fadeInModal 0.4s cubic-bezier(.4,0,.2,1);
    }
    @keyframes fadeInModal {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .modal-content h2 {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 1.2rem;
        background: linear-gradient(90deg, #6c63ff 0%, #4cc9f0 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        color: transparent;
        text-align: center;
        letter-spacing: 1px;
    }
    .modal-close {
        color: #6c757d;
        position: absolute;
        right: 18px;
        top: 10px;
        font-size: 28px;
        font-weight: bold;
        cursor: pointer;
        transition: color 0.2s;
    }
    .modal-close:hover,
    .modal-close:focus {
        color: #343a40;
        text-decoration: none;
        cursor: pointer;
    }
    .modal-content form {
        display: flex;
        flex-direction: column;
        width: 100%;
        align-items: center;
    }
    .modal-content form label {
        margin-bottom: 5px;
        font-weight: 500;
        color: #495057;
        align-self: flex-start;
    }
    .modal-content form input {
        margin-bottom: 14px;
        padding: 12px 16px;
        border: none;
        border-radius: 1.2rem;
        font-size: 1rem;
        outline: none;
        background: rgba(255,255,255,0.85);
        box-shadow: 0 2px 8px rgba(76,201,240,0.08);
        transition: box-shadow 0.2s, border 0.2s;
        width: 100%;
        color: #333;
    }
    .modal-content form input:focus {
        box-shadow: 0 0 0 3px #4cc9f0aa;
        background: #fff;
    }
    .modal-content button[type='submit'] {
        margin-top: 10px;
        background: linear-gradient(90deg, #6c63ff 0%, #4cc9f0 100%);
        color: #fff;
        border: none;
        padding: 12px 0;
        border-radius: 1.2rem;
        cursor: pointer;
        font-size: 1.1rem;
        font-weight: 600;
        width: 100%;
        box-shadow: 0 2px 8px rgba(76,201,240,0.10);
        transition: background 0.2s, transform 0.1s;
        letter-spacing: 1px;
    }
    .modal-content button[type='submit']:hover {
        background: linear-gradient(90deg, #4cc9f0 0%, #6c63ff 100%);
        transform: translateY(-2px) scale(1.03);
    }
.container {
        max-width: 1200px;
        margin: 0 auto; /* [优化] 移动端居中 */
        background-color: #fff;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
    }
    h1 {
        text-align: center;
        margin-bottom: 20px;
        color: #343a40;
    }
    .tab-wrapper {
        margin-top: 20px;
    }
    .tab-buttons {
        display: flex;
        margin-bottom: 10px;
        flex-wrap: wrap; /* [优化] 移动端换行 */
    }
    .tab-button {
        background-color: #e9ecef;
        border: 1px solid #dee2e6;
        padding: 10px 15px;
        border-radius: 4px 4px 0 0;
        cursor: pointer;
        color: #495057; /* tab按钮文字颜色 */
        transition: background-color 0.2s, color 0.2s;
    }
    .tab-button.active {
        background-color: #fff;
        border-bottom: 1px solid #fff;
        color: #212529; /* 选中tab颜色 */
    }
    .tab-button:hover {
        background-color: #f0f0f0;
    }
    .tab-content {
        display: none;
        border: 1px solid #dee2e6;
        padding: 10px;
        border-top: none;
    }
    .tab-content.active {
        display: block;
    }
    
    .import-export {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        justify-content: flex-end;
        flex-wrap: wrap; /* [优化] 移动端换行 */
    }
    
 /* [优化] 添加区域适配移动端 */
    .add-new {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        flex-wrap: wrap; /* 核心：允许换行 */
    }
    .add-new > input {
        flex: 1 1 150px; /* 弹性布局，基础宽度150px，允许伸缩 */
        min-width: 150px; /* 最小宽度 */
    }
    .add-new > button {
        flex-basis: 100%; /* 在移动端，按钮占据一整行 */
    }
    input[type="text"] {
        padding: 10px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        font-size: 1rem;
        outline: none;
        margin-bottom: 5px;
         transition: border-color 0.2s;
    }
	   @media (min-width: 768px) {
        .add-new > button {
            flex-basis: auto; /* 在桌面端，按钮恢复自动宽度 */
        }
    }
    input[type="text"], input[type="number"] {
        padding: 10px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        font-size: 1rem;
        outline: none;
        margin-bottom: 5px;
         transition: border-color 0.2s;
    }
    input[type="text"]:focus, input[type="number"]:focus {
        border-color: #80bdff;
        box-shadow: 0 0 0 0.2rem rgba(0,123,255,.25);
    }
    button {
        background-color: #6c63ff; /* 主色调 */
        color: #fff;
        border: none;
        padding: 10px 15px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
        transition: background-color 0.3s;
    }
    button:hover {
        background-color: #534dc4;
    }
    /* [优化] 保证表格在小屏幕上可以横向滚动 */
    .table-wrapper {
        overflow-x: auto;
    }
    table {
        width: 100%;
        min-width: 800px; /* 设置一个最小宽度，当屏幕小于此值时出现滚动条 */
        border-collapse: collapse;
        margin-bottom: 20px;
    }
    th, td {
        border: 1px solid #dee2e6;
        padding: 10px;
        text-align: left;
        color: #495057; /* 表格文字颜色 */
    }
    th {
        background-color: #f2f2f2;
        font-weight: 600;
    }
    tr:nth-child(even) {
        background-color: #f9f9f9;
    }
    
    .actions {
        display: flex;
        gap: 5px;
    }
    .actions button {
        padding: 5px 8px;
        font-size: 0.8rem;
    }
    .edit-btn {
        background-color: #17a2b8; /* 编辑按钮颜色 */
    }
    
    .del-btn {
        background-color: #dc3545; /* 删除按钮颜色 */
    }
    .pagination {
        text-align: center;
        margin-top: 20px;
    }
    .pagination button {
        margin: 0 5px;
        background-color: #e9ecef; /* 分页按钮颜色 */
        color: #495057;
        border: 1px solid #ced4da;
    }
    .pagination button:hover {
        background-color: #dee2e6;
    }
    
    .success {
        background-color: #28a745;
        color: #fff;
    }
    .error {
        background-color: #dc3545;
        color: #fff;
    }
      `,
          'admin.js': `
          const configTableBody = document.getElementById('configTableBody');
          const prevPageBtn = document.getElementById('prevPage');
          const nextPageBtn = document.getElementById('nextPage');
          const currentPageSpan = document.getElementById('currentPage');
          const totalPagesSpan = document.getElementById('totalPages');
          
          const pendingTableBody = document.getElementById('pendingTableBody');
            const pendingPrevPageBtn = document.getElementById('pendingPrevPage');
            const pendingNextPageBtn = document.getElementById('pendingNextPage');
            const pendingCurrentPageSpan = document.getElementById('pendingCurrentPage');
            const pendingTotalPagesSpan = document.getElementById('pendingTotalPages');
          
          const messageDiv = document.getElementById('message');
          
          const addBtn = document.getElementById('addBtn');
          const addName = document.getElementById('addName');
          const addUrl = document.getElementById('addUrl');
          const addDesc = document.getElementById('addDesc');
          const addLogo = document.getElementById('addLogo');
          const addCatelog = document.getElementById('addCatelog');
		  const addSortOrder = document.getElementById('addSortOrder'); // [新增] 获取排序输入框
          
          const importBtn = document.getElementById('importBtn');
          const importFile = document.getElementById('importFile');
          const exportBtn = document.getElementById('exportBtn');
          
          // [新增] 获取分页相关元素
          const pageInput = document.getElementById('pageInput');
          const goToPageBtn = document.getElementById('goToPage');
          const pendingPageInput = document.getElementById('pendingPageInput');
          const pendingGoToPageBtn = document.getElementById('pendingGoToPage');
          
           const tabButtons = document.querySelectorAll('.tab-button');
            const tabContents = document.querySelectorAll('.tab-content');
          
            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                const tab = button.dataset.tab;
                tabButtons.forEach(b => b.classList.remove('active'));
                 button.classList.add('active');
                tabContents.forEach(content => {
                   content.classList.remove('active');
                    if(content.id === tab) {
                       content.classList.add('active');
                     }
                  })
              });
            });
          
          
          // 添加搜索框
          const searchInput = document.createElement('input');
          searchInput.type = 'text';
          searchInput.placeholder = '搜索书签(名称，URL，分类)';
          searchInput.id = 'searchInput';
          searchInput.style.marginBottom = '10px';
          document.querySelector('.add-new').parentNode.insertBefore(searchInput, document.querySelector('.add-new'));
          
          
          let currentPage = 1;
          let pageSize = 10;
          let totalItems = 0;
          let allConfigs = []; // 保存所有配置数据
          let currentSearchKeyword = ''; // 保存当前搜索关键词
          
          let pendingCurrentPage = 1;
            let pendingPageSize = 10;
            let pendingTotalItems = 0;
            let allPendingConfigs = []; // 保存所有待审核配置数据
          
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
                <label for="editDesc">描述(可选):</label>
                <input type="text" id="editDesc"><br>
                <label for="editLogo">图标 URL(可选):</label>
                <input type="text" id="editLogo"><br>
                <label for="editCatelog">分类:</label>
                <input type="text" id="editCatelog" required><br>
			    <label for="editSortOrder">排序:</label>
                <input type="number" id="editSortOrder"><br>
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
            const desc = document.getElementById('editDesc').value;
            const logo = document.getElementById('editLogo').value;
            const catelog = document.getElementById('editCatelog').value;
                const sort_order = document.getElementById('editSortOrder').value;
            fetch(\`/api/config/\${id}\`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name,
                url,
                desc,
                logo,
                catelog,
				sort_order
              })
            }).then(res => res.json())
              .then(data => {
                if (data.code === 200) {
                  showMessage('修改成功', 'success');
                  fetchConfigs();
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
              
              configTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">加载中...</td></tr>';
              
              fetch(url)
                  .then(res => res.json())
                  .then(data => {
                      if (data.code === 200) {
                          totalItems = data.total;
                          currentPage = data.page;
                          const totalPages = Math.ceil(totalItems / pageSize);
                          
                          // [优化] 批量更新DOM，减少重绘
                          totalPagesSpan.innerText = totalPages;
                          currentPageSpan.innerText = currentPage;
                          allConfigs = data.data;
                          
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
          const fragment = document.createDocumentFragment();
          
           if (configs.length === 0) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="7">没有配置数据</td>';
                fragment.appendChild(row);
            } else {
                configs.forEach(config => {
                    const row = document.createElement('tr');
                    row.innerHTML = \`
                        <td class="name-cell">\${config.name}</td>
                        <td class="url-cell"><a href="\${config.url}" target="_blank">\${config.url}</a></td>
                        <td class="desc-cell">\${config.desc || 'N/A'}</td>
                        <td class="catelog-cell">\${config.catelog}</td>
                        <td class="logo-cell">
                          \${config.logo ? \`<img src="\${config.logo}" alt="logo" style="width:32px;height:32px;object-fit:contain;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22>\${config.name.charAt(0).toUpperCase()}</text></svg>'"/>\` : '<span style="color:#999;font-size:12px;">无</span>'}
                        </td>
                        <td class="sort-cell">\${config.sort_order === 9999 ? '默认' : config.sort_order}</td>
                        <td class="actions">
                          <button class="edit-btn" data-id="\${config.id}">编辑</button>
                          <button class="del-btn" data-id="\${config.id}">删除</button>
                        </td>
                     \`;
                    fragment.appendChild(row);
                });
            }
            
            configTableBody.innerHTML = '';
            configTableBody.appendChild(fragment);
            bindActionEvents();
          }
          
          function bindActionEvents() {
           // [修复] 使用事件委托，并确保只绑定一次事件监听器
           // 先移除可能存在的旧事件监听器
           configTableBody.removeEventListener('click', handleTableClick);
           // 重新绑定事件监听器
           configTableBody.addEventListener('click', handleTableClick);
          }
          
          // [新增] 将事件处理函数提取出来，便于移除和重新绑定
          function handleTableClick(e) {
               if (e.target.classList.contains('edit-btn')) {
                   const id = e.target.dataset.id;
                   handleEdit(id);
               } else if (e.target.classList.contains('del-btn')) {
                   const id = e.target.dataset.id;
                   handleDelete(id);
               }
          }
          
    // [优化] 点击编辑时，直接使用当前数据，避免重复API调用
          function handleEdit(id) {
            const configToEdit = allConfigs.find(c => c.id == id);
            if (!configToEdit) {
                showMessage('找不到要编辑的数据', 'error');
                return;
            }
            
            // [优化] 直接填充表单，避免DOM查询
            const editId = document.getElementById('editId');
            const editName = document.getElementById('editName');
            const editUrl = document.getElementById('editUrl');
            const editDesc = document.getElementById('editDesc');
            const editLogo = document.getElementById('editLogo');
            const editCatelog = document.getElementById('editCatelog');
            const editSortOrder = document.getElementById('editSortOrder');
            
            editId.value = configToEdit.id;
            editName.value = configToEdit.name;
            editUrl.value = configToEdit.url;
            editDesc.value = configToEdit.desc || '';
            editLogo.value = configToEdit.logo || '';
            editCatelog.value = configToEdit.catelog;
            editSortOrder.value = configToEdit.sort_order === 9999 ? '' : configToEdit.sort_order;
            
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
          
          // [新增] 跳转到指定页面
          goToPageBtn.addEventListener('click', () => {
            const targetPage = parseInt(pageInput.value);
            const maxPage = Math.ceil(totalItems / pageSize);
            if (targetPage && targetPage >= 1 && targetPage <= maxPage) {
              fetchConfigs(targetPage);
              pageInput.value = ''; // 清空输入框
            } else {
              showMessage('请输入有效的页码', 'error');
            }
          });
          
          // [新增] 回车键跳转
          pageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              goToPageBtn.click();
            }
          });
          
          addBtn.addEventListener('click', () => {
            const name = addName.value;
            const url = addUrl.value;
            const desc = addDesc.value;
            const logo = addLogo.value;
             const catelog = addCatelog.value;
          const sort_order = addSortOrder.value; // [新增]			 
            if(!name ||    !url || !catelog) {
              showMessage('名称,URL,分类 必填', 'error');
              return;
          }
          fetch('/api/config', {        method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
             name,
             url,
             desc,
             logo,
              catelog,
              sort_order
          })
          }).then(res => res.json())
          .then(data => {
             if(data.code === 201) {
                 showMessage('添加成功', 'success');
                addName.value = '';
                addUrl.value = '';
                addDesc.value = '';
                addLogo.value = '';
                 addCatelog.value = '';
        addSortOrder.value = ''; // [新增]				 
                 fetchConfigs();
             }else {
                showMessage(data.message, 'error');
             }
          }).catch(err => {
            showMessage('网络错误', 'error');
          })
          });
          
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
          
          
          function fetchPendingConfigs(page = pendingCurrentPage) {
                  pendingTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">加载中...</td></tr>';
                  
                  fetch(\`/api/pending?page=\${page}&pageSize=\${pendingPageSize}\`)
                      .then(res => res.json())
                      .then(data => {
                        if (data.code === 200) {
                               pendingTotalItems = data.total;
                               pendingCurrentPage = data.page;
                               const pendingTotalPages = Math.ceil(pendingTotalItems/ pendingPageSize);
                               
                               // [优化] 批量更新DOM
                               pendingTotalPagesSpan.innerText = pendingTotalPages;
                                pendingCurrentPageSpan.innerText = pendingCurrentPage;
                               allPendingConfigs = data.data;
                                 renderPendingConfig(allPendingConfigs);
                                updatePendingPaginationButtons();
                        } else {
                            showMessage(data.message, 'error');
                        }
                      }).catch(err => {
                      showMessage('网络错误', 'error');
                   })
          }
          
            function renderPendingConfig(configs) {
                  const fragment = document.createDocumentFragment();
                  
                  if(configs.length === 0) {
                      const row = document.createElement('tr');
                      row.innerHTML = '<td colspan="8">没有待审核数据</td>';
                      fragment.appendChild(row);
                  } else {
                    configs.forEach(config => {
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                          <td class="name-cell">\${config.name}</td>
                           <td class="url-cell"><a href="\${config.url}" target="_blank">\${config.url}</a></td>
                           <td class="desc-cell">\${config.desc || 'N/A'}</td>
                           <td class="catelog-cell">\${config.catelog}</td>
                           <td class="logo-cell">
                             \${config.logo ? \`<img src="\${config.logo}" alt="logo" style="width:32px;height:32px;object-fit:contain;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22>\${config.name.charAt(0).toUpperCase()}</text></svg>'"/>\` : '<span style="color:#999;font-size:12px;">无</span>'}
                           </td>
                            <td class="sort-cell">\${config.sort_order === 9999 ? '默认' : config.sort_order}</td>
                            <td class="actions">
                                <button class="approve-btn" data-id="\${config.id}">批准</button>
                              <button class="reject-btn" data-id="\${config.id}">拒绝</button>
                            </td>
                          \`;
                        fragment.appendChild(row);
                    });
                  }
                  
                  pendingTableBody.innerHTML = '';
                  pendingTableBody.appendChild(fragment);
                  bindPendingActionEvents();
            }
           function bindPendingActionEvents() {
               // [修复] 使用事件委托，并确保只绑定一次事件监听器
               // 先移除可能存在的旧事件监听器
               pendingTableBody.removeEventListener('click', handlePendingTableClick);
               // 重新绑定事件监听器
               pendingTableBody.addEventListener('click', handlePendingTableClick);
           }
           
           // [新增] 将待审核表格事件处理函数提取出来
           function handlePendingTableClick(e) {
               if (e.target.classList.contains('approve-btn')) {
                   const id = e.target.dataset.id;
                   handleApprove(id);
               } else if (e.target.classList.contains('reject-btn')) {
                   const id = e.target.dataset.id;
                   handleReject(id);
               }
           }
          function handleApprove(id) {
             if (!confirm('确定批准吗？')) return;
             fetch(\`/api/pending/\${id}\`, {
                   method: 'PUT',
                 }).then(res => res.json())
               .then(data => {
                    if (data.code === 200) {
                        showMessage('批准成功', 'success');
                        fetchPendingConfigs();
                         fetchConfigs();
                    } else {
                         showMessage(data.message, 'error')
                     }
                }).catch(err => {
                      showMessage('网络错误', 'error');
                  })
          }
           function handleReject(id) {
               if (!confirm('确定拒绝吗？')) return;
              fetch(\`/api/pending/\${id}\`, {
                     method: 'DELETE'
                }).then(res => res.json())
                   .then(data => {
                     if(data.code === 200) {
                         showMessage('拒绝成功', 'success');
                        fetchPendingConfigs();
                    } else {
                       showMessage(data.message, 'error');
                   }
                  }).catch(err => {
                        showMessage('网络错误', 'error');
                })
           }
          function updatePendingPaginationButtons() {
              pendingPrevPageBtn.disabled = pendingCurrentPage === 1;
               pendingNextPageBtn.disabled = pendingCurrentPage >= Math.ceil(pendingTotalItems/ pendingPageSize)
           }
          
           pendingPrevPageBtn.addEventListener('click', () => {
               if (pendingCurrentPage > 1) {
                   fetchPendingConfigs(pendingCurrentPage - 1);
               }
           });
            pendingNextPageBtn.addEventListener('click', () => {
               if (pendingCurrentPage < Math.ceil(pendingTotalItems/pendingPageSize)) {
                   fetchPendingConfigs(pendingCurrentPage + 1)
               }
            });
            
            // [新增] 待审核列表跳转到指定页面
            pendingGoToPageBtn.addEventListener('click', () => {
              const targetPage = parseInt(pendingPageInput.value);
              const maxPage = Math.ceil(pendingTotalItems / pendingPageSize);
              if (targetPage && targetPage >= 1 && targetPage <= maxPage) {
                fetchPendingConfigs(targetPage);
                pendingPageInput.value = ''; // 清空输入框
              } else {
                showMessage('请输入有效的页码', 'error');
              }
            });
            
            // [新增] 待审核列表回车键跳转
            pendingPageInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                pendingGoToPageBtn.click();
              }
            });
          fetchConfigs();
          fetchPendingConfigs();
          `
    }
    return fileContents[filePath]
    },
  
    async renderAdminPage() {
    const html = await this.getFileContent('admin.html');
    return new Response(html, {
        headers: {'Content-Type': 'text/html; charset=utf-8'}
    });
    },
  
    async renderLoginPage() {
      const html = `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>管理员登录</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
          *, *::before, *::after {
            box-sizing: border-box;
          }
          html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            font-family: 'Noto Sans SC', sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          body {
            min-height: 100vh;
            min-width: 100vw;
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #7209b7 0%, #4cc9f0 100%);
            /* 渐变背景 */
            overflow: hidden;
          }
          .login-container {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 400px;
            padding: 2.5rem 2rem 2rem 2rem;
            border-radius: 2rem;
            background: rgba(255,255,255,0.18);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.18);
            backdrop-filter: blur(18px) saturate(1.5);
            -webkit-backdrop-filter: blur(18px) saturate(1.5);
            border: 2px solid rgba(255,255,255,0.25);
            border-image: linear-gradient(120deg, #7209b7 0%, #4cc9f0 100%) 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            animation: fadeIn 0.7s cubic-bezier(.4,0,.2,1);
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .login-title {
            font-size: 2.2rem;
            font-weight: 700;
            text-align: center;
            margin-bottom: 2rem;
            background: linear-gradient(90deg, #7209b7 30%, #4cc9f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            color: transparent;
            letter-spacing: 2px;
          }
          .form-group {
            width: 100%;
            margin-bottom: 1.5rem;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          label {
            align-self: flex-start;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: #3b1f75;
            letter-spacing: 1px;
          }
          input[type="text"], input[type="password"] {
            width: 100%;
            padding: 0.9rem 1.1rem;
            border: none;
            border-radius: 1rem;
            font-size: 1.1rem;
            background: rgba(255,255,255,0.7);
            box-shadow: 0 2px 8px rgba(76,201,240,0.08);
            transition: box-shadow 0.2s, border 0.2s;
            outline: none;
            color: #333;
          }
          input[type="text"]:focus, input[type="password"]:focus {
            box-shadow: 0 0 0 3px #4cc9f0aa;
            background: rgba(255,255,255,0.95);
          }
          button {
            width: 100%;
            padding: 0.95rem;
            margin-top: 0.5rem;
            background: linear-gradient(90deg, #7209b7 0%, #4cc9f0 100%);
            color: #fff;
            border: none;
            border-radius: 1rem;
            font-size: 1.15rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(76,201,240,0.12);
            transition: background 0.2s, transform 0.1s;
            letter-spacing: 1px;
          }
          button:hover {
            background: linear-gradient(90deg, #4cc9f0 0%, #7209b7 100%);
            transform: translateY(-2px) scale(1.03);
          }
          .error-message {
            color: #dc3545;
            font-size: 0.95rem;
            margin-top: 0.5rem;
            text-align: center;
            display: none;
            background: rgba(255,255,255,0.7);
            border-radius: 0.5rem;
            padding: 0.5rem 0;
          }
          .back-link {
            display: block;
            text-align: center;
            margin-top: 2rem;
            color: #4cc9f0;
            text-decoration: none;
            font-size: 1rem;
            font-weight: 500;
            letter-spacing: 1px;
            transition: color 0.2s;
          }
          .back-link:hover {
            color: #7209b7;
            text-decoration: underline;
          }
          /* 背景装饰光斑 */
          .bg-blur {
            position: absolute;
            z-index: 0;
            border-radius: 50%;
            filter: blur(60px);
            opacity: 0.35;
            pointer-events: none;
          }
          .bg-blur1 {
            width: 400px; height: 400px;
            top: -120px; left: -120px;
            background: linear-gradient(120deg, #7209b7 0%, #4cc9f0 100%);
          }
          .bg-blur2 {
            width: 300px; height: 300px;
            bottom: -100px; right: -100px;
            background: linear-gradient(120deg, #4cc9f0 0%, #7209b7 100%);
          }
          @media (max-width: 500px) {
            .login-container {
              padding: 1.5rem 0.7rem 1.2rem 0.7rem;
              max-width: 98vw;
            }
            .login-title {
              font-size: 1.4rem;
            }
          }
        </style>
      </head>
      <body>
        <div class="bg-blur bg-blur1"></div>
        <div class="bg-blur bg-blur2"></div>
        <div class="login-container">
          <h1 class="login-title">管理员登录</h1>
          <form id="loginForm" autocomplete="off">
            <div class="form-group">
              <label for="username">用户名</label>
              <input type="text" id="username" name="username" required autocomplete="username">
            </div>
            <div class="form-group">
              <label for="password">密码</label>
              <input type="password" id="password" name="password" required autocomplete="current-password">
            </div>
            <div class="error-message" id="errorMessage">用户名或密码错误</div>
            <button type="submit">登 录</button>
          </form>
          <a href="/" class="back-link">返回首页</a>
        </div>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            const loginForm = document.getElementById('loginForm');
            const errorMessage = document.getElementById('errorMessage');
            loginForm.addEventListener('submit', function(e) {
              e.preventDefault();
              const username = document.getElementById('username').value;
              const password = document.getElementById('password').value;
              window.location.href = '/admin?name=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
            });
          });
        </script>
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

    // 获取所有分类
    const catalogs = Array.from(new Set(sites.map(s => s.catelog)));
    
    // 根据 URL 参数筛选站点
    const currentCatalog = catalog || catalogs[0];
    const currentSites = catalog ? sites.filter(s => s.catelog === currentCatalog) : sites;

    // 为每个站点提取首字母
    const sitesWithFirstLetter = currentSites.map(site => {
      const firstLetter = site.name ? site.name.charAt(0).toUpperCase() : '';
      return { ...site, firstLetter };
    });
    // 优化后的 HTML
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>琪舟阁 - 指路人，亦是摘星人</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet"/>
      <link rel="icon" href="https://img.520jacky.dpdns.org/i/2026/02/12/866586.webp" type="image/webp"/>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                primary: {
                  50: '#f4f1fd',
                  100: '#e9e3fb',
                  200: '#d3c7f7',
                  300: '#b0a0f0',
                  400: '#8a70e7',
                  500: '#7209b7',
                  600: '#6532cc',
                  700: '#5429ab',
                  800: '#46238d',
                  900: '#3b1f75',
                  950: '#241245',
                },
                secondary: {
                  50: '#eef4ff',
                  100: '#e0ebff',
                  200: '#c7d9ff',
                  300: '#a3beff',
                  400: '#7a9aff',
                  500: '#5a77fb',
                  600: '#4361ee',
                  700: '#2c4be0',
                  800: '#283db6',
                  900: '#253690',
                  950: '#1a265c',
                },
                accent: {
                  50: '#ecfdff',
                  100: '#d0f7fe',
                  200: '#a9eefe',
                  300: '#72e0fd',
                  400: '#33cafc',
                  500: '#4cc9f0',
                  600: '#0689cb',
                  700: '#0b6ca6',
                  800: '#115887',
                  900: '#134971',
                  950: '#0c2d48',
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
        /* 自定义滚动条 */
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb {
          background: #d3c7f7;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #7209b7;
        }
        
        /* 卡片悬停效果 */
        .site-card {
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .site-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
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
      </style>
    </head>
    <body class="bg-gray-50 font-sans text-gray-800">
      <!-- 侧边栏开关 -->
      <input type="checkbox" id="sidebar-toggle" class="hidden">
      
      <!-- 移动端导航按钮 -->
      <div class="fixed top-4 left-4 z-50 lg:hidden">
        <button id="sidebarToggle" class="p-2 rounded-lg bg-white shadow-md hover:bg-gray-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      
      <!-- 移动端遮罩层 - 只在移动端显示 -->
      <div id="mobileOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-40 mobile-overlay lg:hidden"></div>
      
      <!-- 桌面侧边栏开关按钮 -->
      <div class="fixed top-4 left-4 z-50 hidden lg:block">
        <label for="sidebar-toggle" class="p-2 rounded-lg bg-white shadow-md hover:bg-gray-100 inline-block cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </label>
      </div>
      
      <!-- 侧边栏导航 -->
      <aside id="sidebar" class="sidebar fixed left-0 top-0 h-full w-64 bg-white shadow-lg z-50 overflow-y-auto mobile-sidebar lg:transform-none transition-all duration-300">
        <div class="p-6">
          <div class="flex items-center justify-between mb-8">
            <h2 class="text-2xl font-bold sidebar-title-gradient">琪舟阁</h2>
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
              <input id="searchInput" type="text" placeholder="搜索书签..." class="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          <div>
            <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">分类导航</h3>
            <div class="space-y-1">
              <a href="?" class="flex items-center px-3 py-2 rounded-lg w-full border-2 border-primary-100 bg-gradient-to-r from-white via-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-colors duration-200 ${!catalog ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'}">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 ${!catalog ? 'text-primary-500' : 'text-gray-400'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                全部
              </a>
              ${catalogs.map(cat => `
                <a href="?catalog=${cat}" class="flex items-center px-3 py-2 rounded-lg w-full border-2 border-primary-100 bg-gradient-to-r from-white via-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-colors duration-200 ${cat === currentCatalog && catalog ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'}">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 ${cat === currentCatalog && catalog ? 'text-primary-500' : 'text-gray-400'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  ${cat}
                </a>
              `).join('')}
            </div>
          </div>
          
          <div class="mt-8 pt-6 border-t border-gray-200">
            <button id="addSiteBtnSidebar" class="w-full flex items-center justify-center px-4 py-2 bg-gradient-to-r from-white via-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 text-primary-700 rounded-lg border-2 border-primary-100 shadow-sm transition duration-300">
              添加新书签
            </button>
            
            <a href="https://blog.520jacky.ip-ddns.com" target="_blank" class="mt-4 flex items-center px-4 py-2 text-gray-600 hover:text-primary-500 transition duration-300 w-full border-2 border-primary-100 bg-gradient-to-r from-white via-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              访问博客
            </a>

            <a href="/admin" target="_blank" class="mt-4 flex items-center px-4 py-2 text-gray-600 hover:text-primary-500 transition duration-300 w-full border-2 border-primary-100 bg-gradient-to-r from-white via-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              后台管理
            </a>
          </div>
        </div>
      </aside>
      
      <!-- 主内容区 -->
      <main class="main-content lg:ml-64 min-h-screen transition-all duration-300 bg-gradient-to-br from-primary-50 via-accent-50 to-secondary-100">
        <!-- 顶部横幅 -->
        <header class="relative overflow-hidden py-14 px-6 md:px-12 flex flex-col items-center justify-center bg-gradient-to-r from-primary-500 via-secondary-400 to-accent-400 shadow-xl">
          <div class="absolute inset-0 z-0" style="background: linear-gradient(120deg,rgba(255,255,255,0.08) 0%,rgba(76,201,240,0.12) 60%,rgba(114,9,183,0.10) 100%);"></div>
          <div class="relative z-10 text-center">
            <h1 class="text-3xl md:text-4xl font-extrabold mb-4 bg-gradient-to-r from-primary-300 via-secondary-500 to-accent-400 bg-clip-text text-transparent drop-shadow-lg animate-gradient-text">琪舟阁</h1>
            <p class="text-lg md:text-xl font-light bg-gradient-to-r from-primary-100 via-secondary-200 to-accent-200 bg-clip-text text-transparent mb-2">万千星河，总有一束光，指向你未曾抵达的远方</p>
          </div>
        </header>
        <!-- 全局搜索框 -->
        <div class="w-full flex flex-col items-center justify-center px-2 mt-4">
          <form id="globalSearchForm" class="flex flex-row items-center gap-2 w-full max-w-2xl" style="flex-wrap:nowrap;">
            <input id="globalSearchInput" type="text" placeholder="搜索网页"
              class="flex-1 px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition bg-white text-base min-w-0"
              required />
            <select id="globalSearchEngine"
              class="px-2 py-2 border-2 border-primary-100 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 text-base min-w-0" style="width:90px;">
              <option value="bing">Bing</option>
              <option value="google">Google</option>
              <option value="baidu">百度</option>
              <option value="github">GitHub</option>
            </select>
            <button type="submit"
              class="px-4 py-2 border-2 border-primary-200 shadow-sm text-base font-bold rounded-lg text-white bg-gradient-to-r from-primary-400 via-secondary-400 to-accent-400 hover:from-primary-500 hover:to-accent-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition min-w-0" style="white-space:nowrap;">搜索</button>
          </form>
        </div>
        <style>
        @media (max-width: 640px) {
          #globalSearchForm {
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            gap: 0.5rem !important;
          }
          #globalSearchInput, #globalSearchEngine, #globalSearchForm button {
            min-width: 0 !important;
            font-size: 1rem !important;
          }
          #globalSearchInput {
            flex: 1 1 0%;
          }
          #globalSearchEngine {
            width: 80px !important;
          }
          #globalSearchForm button {
            padding-left: 0.8rem;
            padding-right: 0.8rem;
          }
        }
        </style>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            var form = document.getElementById('globalSearchForm');
            if(form) {
              form.addEventListener('submit', function(e) {
                e.preventDefault();
                var kw = document.getElementById('globalSearchInput').value.trim();
                var engine = document.getElementById('globalSearchEngine').value;
                if(!kw) return;
                var url = '';
                switch(engine) {
                  case 'bing':
                    url = 'https://www.bing.com/search?q=' + encodeURIComponent(kw); break;
                  case 'google':
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(kw); break;
                  case 'baidu':
                    url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(kw); break;
                  case 'github':
                    url = 'https://github.com/search?q=' + encodeURIComponent(kw); break;
                  default:
                    url = 'https://www.bing.com/search?q=' + encodeURIComponent(kw);
                }
                window.open(url, '_blank');
              });
            }
          });
        </script>
        <!-- 网站列表 -->
        <section class="max-w-7xl mx-auto px-4 sm:px-8 py-14">
          <!-- 当前分类/搜索提示 -->
          <div class="flex flex-col sm:flex-row items-center justify-between mb-10 gap-4">
            <h2 class="text-2xl md:text-3xl font-bold flex items-center gap-2 bg-gradient-to-r from-primary-400 via-secondary-500 to-accent-400 bg-clip-text text-transparent">
              <span id="siteCount">${catalog ? `${currentCatalog} · ${currentSites.length} 个网站` : `全部收藏 · ${sites.length} 个网站`}</span>
            </h2>
            <div class="text-sm px-5 py-2 rounded-full shadow-lg flex items-center gap-2 bg-gradient-to-r from-primary-200 via-secondary-100 to-accent-100 border border-primary-100">
              <script>
               fetch('https://v1.hitokoto.cn')
                .then(response => response.json())
                .then(data => {
                const hitokoto = document.getElementById('hitokoto_text')
                hitokoto.href = 'https://github.com/BAYUEQI' 
                hitokoto.innerText = data.hitokoto
                })
                .catch(console.error)
              </script>
              <div id="hitokoto"><a href="#" target="_blank" id="hitokoto_text">指路人，亦是摘星人</a></div>
            </div>
          </div>
          <!-- 网站卡片网格 -->
          <div id="sitesGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            ${sitesWithFirstLetter.map(site => `
              <div class="site-card group rounded-3xl shadow-2xl border-2 border-transparent hover:border-accent-300 bg-gradient-to-br from-white via-primary-50 to-accent-50 hover:from-primary-100 hover:to-accent-100 transition-all duration-300 relative overflow-hidden" data-name="${site.name || ''}" data-url="${site.url || ''}" data-catalog="${site.catelog || ''}">
                <div class="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-primary-200 via-accent-100 to-secondary-100 rounded-full opacity-30 blur-2xl z-0"></div>
                <div class="p-7 relative z-10 flex flex-col h-full">
                  <a href="${site.url}" target="_blank" class="block">
                    <div class="flex items-center mb-4">
                      <div class="flex-shrink-0 mr-5">
                        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-400 via-secondary-400 to-accent-400 flex items-center justify-center text-white font-extrabold text-3xl shadow-lg border-2 border-primary-200 overflow-hidden">
                          ${site.logo && site.logo.trim() ? `<img src="${site.logo}" alt="${site.name}" onerror="this.style.display='none'; this.parentElement.innerText='${site.firstLetter}';" class="w-full h-full object-contain p-2"/>` : `<span>${site.firstLetter}</span>`}
                        </div>
                      </div>
                      <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold bg-gradient-to-r from-primary-500 via-secondary-500 to-accent-500 bg-clip-text text-transparent truncate">${site.name}</h3>
                        <span class="inline-flex items-center px-3 py-1 mt-2 rounded-full text-xs font-bold bg-gradient-to-r from-primary-200 via-secondary-200 to-accent-200 text-primary-800 shadow border border-primary-100">
                          ${site.catelog}
                        </span>
                      </div>
                    </div>
                    <p class="mt-2 text-sm text-gray-700 line-clamp-2 bg-gradient-to-r from-primary-50 via-accent-50 to-secondary-100 rounded-lg px-2 py-1 shadow-inner" title="${site.desc || '暂无描述'}">${site.desc || '暂无描述'}</p>
                  </a>
                  <div class="mt-auto flex items-center justify-between pt-5">
                    <span class="text-xs text-gray-400 truncate max-w-[140px] font-mono">${site.url}</span>
                    <button class="copy-btn flex items-center px-3 py-1 bg-gradient-to-r from-primary-300 via-secondary-200 to-accent-200 text-primary-700 hover:from-accent-300 hover:to-primary-200 rounded-full text-xs font-bold transition-all duration-200 shadow-md border border-primary-200 relative group/copy" data-url="${site.url}">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      复制
                      <span class="copy-success hidden absolute -top-8 right-0 bg-gradient-to-r from-green-400 to-accent-400 text-white text-xs px-2 py-1 rounded shadow-md">已复制!</span>
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
        <!-- 页脚 -->
        <footer class="bg-gradient-to-r from-primary-50 via-secondary-50 to-accent-50 py-10 px-6 mt-20 border-t-4 border-gradient-to-r from-primary-200 via-secondary-200 to-accent-200 shadow-inner">
          <div class="max-w-5xl mx-auto text-center">
            <div class="w-full h-2 bg-gradient-to-r from-primary-200 via-secondary-200 to-accent-200 rounded-full mb-8 opacity-80"></div>
            <p class="text-lg font-bold bg-gradient-to-r from-primary-400 via-secondary-500 to-accent-400 bg-clip-text text-transparent">© ${new Date().getFullYear()} 琪舟阁 | 愿你在此找到方向</p>
            <div class="mt-6 flex justify-center space-x-8">
              <a href="https://blog.520jacky.ip-ddns.com/" target="_blank" class="text-gray-400 hover:text-primary-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </a>
            </div>
          </div>
        </footer>
      </main>
      <style>
        /* 只保留主标题轻微动画，其余全部静态渐变，提升性能 */
        @keyframes gradient-text {
          0% { filter: brightness(1) saturate(1); }
          50% { filter: brightness(1.15) saturate(1.2); }
          100% { filter: brightness(1) saturate(1); }
        }
        .animate-gradient-text {
          animation: gradient-text 3s ease-in-out infinite;
        }
      </style>
      
      <!-- 返回顶部按钮 -->
      <button id="backToTop" class="fixed bottom-8 right-8 z-50 p-3 rounded-full bg-gradient-to-r from-primary-400 via-secondary-400 to-accent-400 text-white shadow-lg opacity-0 invisible transition-all duration-300 hover:brightness-110 hover:shadow-2xl border-2 border-primary-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 11l7-7 7 7M5 19l7-7 7 7" />
        </svg>
      </button>
      
      <!-- 添加网站模态框 -->
      <div id="addSiteModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 opacity-0 invisible transition-all duration-300">
        <div class="w-full max-w-md mx-4 transform translate-y-8 transition-all duration-300 rounded-2xl shadow-2xl border-2 border-blue-100 bg-gradient-to-br from-white via-blue-50 to-blue-100">
          <div class="p-8">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-2xl font-bold bg-gradient-to-r from-primary-400 via-secondary-400 to-accent-400 bg-clip-text text-transparent">添加新书签</h2>
              <button id="closeModal" class="text-gray-400 hover:text-primary-500 transition-colors rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-primary-200">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form id="addSiteForm" class="space-y-5">
              <div>
                <label for="addSiteName" class="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input type="text" id="addSiteName" required class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition"/>
              </div>
              <div>
                <label for="addSiteUrl" class="block text-sm font-medium text-gray-700 mb-1">网址</label>
                <input type="text" id="addSiteUrl" required class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition"/>
              </div>
              <div>
                <label for="addSiteDesc" class="block text-sm font-medium text-gray-700 mb-1">描述 (可选)</label>
                <textarea id="addSiteDesc" rows="2" class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition"></textarea>
              </div>
              <div>
                <label for="addSiteLogo" class="block text-sm font-medium text-gray-700 mb-1">图标 URL (可选)</label>
                <input type="text" id="addSiteLogo" class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition" placeholder="留空则自动获取网站图标"/>
              </div>
              <div>
                <label for="addSiteCatelog" class="block text-sm font-medium text-gray-700 mb-1">分类</label>
                <input type="text" id="addSiteCatelog" required class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition" list="catalogList"/>
                <datalist id="catalogList">
                  ${catalogs.map(cat => `<option value="${cat}">`).join('')}
                </datalist>
              </div>
              <div>
                <label for="addSiteSortOrder" class="block text-sm font-medium text-gray-700 mb-1">排序（可选）</label>
                <input type="number" id="addSiteSortOrder" class="mt-1 block w-full px-4 py-2 border-2 border-primary-100 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition" placeholder="不填则自动排到最后"/>
              </div>
              <div class="flex justify-end pt-6 gap-3">
                <button type="button" id="cancelAddSite" class="bg-gray-100 text-gray-600 border border-gray-200 rounded-lg px-5 py-2 font-medium hover:bg-gray-200 transition">取消</button>
                <button type="submit" class="inline-flex justify-center px-6 py-2 border-2 border-primary-200 shadow-sm text-sm font-bold rounded-lg text-white bg-gradient-to-r from-primary-400 via-secondary-400 to-accent-400 hover:from-primary-500 hover:to-accent-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition">提交</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      
      <script>
        document.addEventListener('DOMContentLoaded', function() {
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
              backToTop.classList.remove('opacity-0', 'invisible');
            } else {
              backToTop.classList.add('opacity-0', 'invisible');
            }
          });
          
          if (backToTop) {
            backToTop.addEventListener('click', function() {
              window.scrollTo({
                top: 0,
                behavior: 'smooth'
              });
            });
          }
          
          // 添加网站模态框
          const addSiteModal = document.getElementById('addSiteModal');
          const addSiteBtnSidebar = document.getElementById('addSiteBtnSidebar');
          const closeModalBtn = document.getElementById('closeModal');
          const cancelAddSite = document.getElementById('cancelAddSite');
          const addSiteForm = document.getElementById('addSiteForm');
          
          function openModal() {
            if (addSiteModal) {
              addSiteModal.classList.remove('opacity-0', 'invisible');
              const modalContent = addSiteModal.querySelector('.max-w-md');
              if (modalContent) modalContent.classList.remove('translate-y-8');
              document.body.style.overflow = 'hidden';
            }
          }
          
          function closeModal() {
            if (addSiteModal) {
              addSiteModal.classList.add('opacity-0', 'invisible');
              const modalContent = addSiteModal.querySelector('.max-w-md');
              if (modalContent) modalContent.classList.add('translate-y-8');
              document.body.style.overflow = '';
            }
          }
          
          if (addSiteBtnSidebar) {
            addSiteBtnSidebar.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              console.log('添加书签按钮被点击');
              openModal();
            });
          } else {
            console.error('未找到添加书签按钮元素');
          }
          
          if (closeModalBtn) {
            closeModalBtn.addEventListener('click', function() {
              closeModal();
            });
          }
          
          if (cancelAddSite) {
            cancelAddSite.addEventListener('click', closeModal);
          }
          
          if (addSiteModal) {
            addSiteModal.addEventListener('click', function(e) {
              if (e.target === addSiteModal) {
                closeModal();
              }
            });
          }
          
          // 表单提交处理
          if (addSiteForm) {
            addSiteForm.addEventListener('submit', function(e) {
              e.preventDefault();
              
              const name = document.getElementById('addSiteName').value;
              const url = document.getElementById('addSiteUrl').value;
              const desc = document.getElementById('addSiteDesc').value;
              const logo = document.getElementById('addSiteLogo').value;
              const catelog = document.getElementById('addSiteCatelog').value;
              const sort_order = document.getElementById('addSiteSortOrder').value;
              
              fetch('/api/config/submit', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, url, desc, logo, catelog, sort_order })
              })
              .then(res => res.json())
              .then(data => {
                if (data.code === 201) {
                  // 显示成功消息
                  const successDiv = document.createElement('div');
                  successDiv.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg z-50 animate-fade-in';
                  successDiv.textContent = '提交成功，等待管理员审核';
                  document.body.appendChild(successDiv);
                  
                  setTimeout(() => {
                    successDiv.classList.add('opacity-0');
                    setTimeout(() => {
                      if (document.body.contains(successDiv)) {
                        document.body.removeChild(successDiv);
                      }
                    }, 300);
                  }, 2500);
                  
                  closeModal();
                  addSiteForm.reset();
                } else {
                  alert(data.message || '提交失败');
                }
              })
              .catch(err => {
                console.error('网络错误:', err);
                alert('网络错误，请稍后重试');
              });
            });
          }
          
          // 搜索功能
          const searchInput = document.getElementById('searchInput');
          const sitesGrid = document.getElementById('sitesGrid');
          const siteCards = document.querySelectorAll('.site-card');
          const siteCountSpan = document.getElementById('siteCount');
          const originalSiteCountText = siteCountSpan ? siteCountSpan.textContent : '';

          if (searchInput && sitesGrid) {
            searchInput.addEventListener('input', function() {
              const keyword = this.value.toLowerCase().trim();
              
              siteCards.forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const url = (card.getAttribute('data-url') || '').toLowerCase();
                const catalog = (card.getAttribute('data-catalog') || '').toLowerCase();
                
                if (name.includes(keyword) || url.includes(keyword) || catalog.includes(keyword)) {
                  card.classList.remove('hidden');
                } else {
                  card.classList.add('hidden');
                }
              });
              
              // 搜索结果提示
              const visibleCards = sitesGrid.querySelectorAll('.site-card:not(.hidden)');
              if (siteCountSpan) {
                if (keyword) {
                  siteCountSpan.textContent = '搜索结果 · ' + visibleCards.length + ' 个网站';
                } else {
                  siteCountSpan.textContent = originalSiteCountText;
                }
              }
            });
          }
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
  
  if (url.pathname.startsWith('/api')) {
    return api.handleRequest(request, env, ctx);
  } else if (url.pathname === '/admin' || url.pathname.startsWith('/static')) {
    return admin.handleRequest(request, env, ctx);
  } else {
    return handleRequest(request, env, ctx);
  }
},
};
