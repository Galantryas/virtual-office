/**
 * 2D Virtual Dev Office - High-Performance Static Web Server (Node.js)
 * Fully asynchronous, non-blocking, zero external dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BODY = 8000000; // Batas maksimum body request (8MB)

const PORT = 3000;
const HOST = '0.0.0.0';

// Safe containment check: true only when `target` is inside `baseDir` (or equal).
// A plain startsWith() would wrongly accept e.g. base "C:\proj" for "C:\proj-evil".
function isInside(baseDir, target) {
  const base = path.resolve(baseDir);
  const rel = path.relative(base, path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoints for Project Context & @file mentions
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/api/')) {
    let body = '';
    let bodyTooLarge = false;
    req.on('data', chunk => {
      if (bodyTooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY) {
        bodyTooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Payload terlalu besar (maks 8MB).' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) return;
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch (e) {}

      // 1. Validate local directory
      if (pathname === '/api/project/validate' && req.method === 'POST') {
        const targetDir = (data.path || '').trim();
        if (!targetDir) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Path folder tidak boleh kosong.' }));
        }
        fs.stat(targetDir, (err, stats) => {
          if (err || !stats.isDirectory()) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Folder tidak ditemukan atau bukan direktori.' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, path: path.resolve(targetDir) }));
        });
        return;
      }

      // 2. Scan project directory for files
      if (pathname === '/api/project/scan' && req.method === 'POST') {
        const targetDir = (data.path || '').trim();
        if (!targetDir) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Path folder tidak boleh kosong.' }));
        }

        const ignored = new Set(['node_modules', '.git', '.vscode', '.idea', 'dist', 'build', 'vendor', '__pycache__', '.system_generated', 'tmp', 'temp', '.next', '.cache']);
        const filesList = [];
        const maxFiles = 1000;

        function walk(currentDir, relativePrefix = '') {
          if (filesList.length >= maxFiles) return;
          try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
              if (filesList.length >= maxFiles) break;
              if (ignored.has(entry.name)) continue;

              const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
              const full = path.join(currentDir, entry.name);

              if (entry.isDirectory()) {
                walk(full, rel);
              } else if (entry.isFile()) {
                filesList.push(rel.replace(/\\/g, '/'));
              }
            }
          } catch (e) {}
        }

        try {
          if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Folder tidak ditemukan.' }));
          }
          walk(targetDir);
          filesList.sort((a, b) => a.localeCompare(b));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            path: path.resolve(targetDir),
            files: filesList,
            count: filesList.length
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      // 3. Read specific file content for @file mention
      if (pathname === '/api/project/read' && req.method === 'POST') {
        const baseDir = (data.projectPath || '').trim();
        const relPath = (data.filePath || '').trim().replace(/^@/, '');

        if (!baseDir || !relPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan filePath wajib disertakan.' }));
        }

        const fullPath = path.resolve(baseDir, relPath);
        // Security check: ensure path stays within baseDir
        if (!fullPath.startsWith(path.resolve(baseDir))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Akses di luar folder project ditolak.' }));
        }

        fs.readFile(fullPath, 'utf8', (err, content) => {
          if (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: `Gagal membaca file: ${err.message}` }));
          }
          // Truncate if file is overly massive (> 60KB) to prevent context explosion
          let truncated = false;
          if (content.length > 60000) {
            content = content.substring(0, 60000) + '\n\n[... File dipotong karena melebihi batas 60KB ...]';
            truncated = true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, filePath: relPath, content, truncated }));
        });
        return;
      }

      // 4. Health check
      if (pathname === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, node: true }));
      }

      // 5. Tulis catatan (notes) ke dalam project
      if (pathname === '/api/notes/write' && req.method === 'POST') {
        const projectPath = (data.projectPath || '').trim();
        const subdir = (data.subdir || 'meetings').trim();
        const fileName = (data.fileName || '').trim();
        const content = typeof data.content === 'string' ? data.content : '';
        const safeSeg = /^[A-Za-z0-9._\-/]+$/;

        if (!projectPath || !fileName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan fileName wajib disertakan.' }));
        }
        // Sanitasi segmen path: hanya karakter aman, tanpa '..'
        if (!safeSeg.test(subdir) || !safeSeg.test(fileName) || subdir.includes('..') || fileName.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'subdir atau fileName tidak valid.' }));
        }

        const relPath = path.join(subdir, fileName).replace(/\\/g, '/');
        const fullPath = path.resolve(projectPath, relPath);
        if (!isInside(projectPath, fullPath)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Akses di luar folder project ditolak.' }));
        }

        try {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, path: relPath }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      // 6. Daftar file catatan (*.md), terbaru lebih dulu
      if (pathname === '/api/notes/list' && req.method === 'POST') {
        const projectPath = (data.projectPath || '').trim();
        const subdir = (data.subdir || 'meetings').trim() || 'meetings';

        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath wajib disertakan.' }));
        }

        const dirPath = path.resolve(projectPath, subdir);
        if (!isInside(projectPath, dirPath)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Akses di luar folder project ditolak.' }));
        }

        try {
          if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, files: [] }));
          }
          const files = fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
            .map(entry => {
              const st = fs.statSync(path.join(dirPath, entry.name));
              return { name: entry.name, size: st.size, mtime: st.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, files }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      // 7. Baca isi file catatan
      if (pathname === '/api/notes/read' && req.method === 'POST') {
        const baseDir = (data.projectPath || '').trim();
        const relPath = (data.filePath || '').trim().replace(/^@/, '');

        if (!baseDir || !relPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan filePath wajib disertakan.' }));
        }

        const fullPath = path.resolve(baseDir, relPath);
        if (!isInside(baseDir, fullPath)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Akses di luar folder project ditolak.' }));
        }

        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, content }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: `Gagal membaca file: ${e.message}` }));
        }
      }

      // 8. Daftar skills dari .agents/skills/*/SKILL.md
      if (pathname === '/api/skills/list' && (req.method === 'GET' || req.method === 'POST')) {
        const projectPath = (data.projectPath || '').trim();

        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath wajib disertakan.' }));
        }

        const skillsRoot = path.resolve(projectPath, '.agents', 'skills');
        try {
          if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, skills: [] }));
          }

          const skills = [];
          const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            let name = '';
            let description = '';
            try {
              const lines = fs.readFileSync(skillFile, 'utf8').split(/\r?\n/).slice(0, 40);
              let inFrontmatter = false;
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '---') { inFrontmatter = !inFrontmatter; continue; }
                if (inFrontmatter) {
                  const nameMatch = trimmed.match(/^name:\s*(.+)$/i);
                  if (nameMatch && !name) name = nameMatch[1].replace(/^["']|["']$/g, '').trim();
                  const descMatch = trimmed.match(/^description:\s*(.+)$/i);
                  if (descMatch && !description) description = descMatch[1].replace(/^["']|["']$/g, '').trim();
                  continue;
                }
                if (!name && /^#\s+/.test(trimmed)) name = trimmed.replace(/^#\s+/, '').trim();
                if (!description && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                  description = trimmed;
                }
              }
            } catch (e) {}

            skills.push({
              name: name || entry.name,
              description: description || '',
              dir: entry.name
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, skills }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      // 9. Terapkan banyak file sekaligus (dengan backup opsional)
      if (pathname === '/api/files/apply' && req.method === 'POST') {
        const projectPath = (data.projectPath || '').trim();
        const files = Array.isArray(data.files) ? data.files : [];
        const doBackup = data.backup !== false;

        if (!projectPath || !files.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan files wajib disertakan.' }));
        }

        const base = path.resolve(projectPath);
        const backupDir = path.join(base, '.voffice_backups', String(Date.now()));
        const applied = [];

        try {
          for (const file of files) {
            const relPath = (file && file.path ? String(file.path) : '').replace(/\\/g, '/').replace(/^\/+/, '');
            const content = file && typeof file.content === 'string' ? file.content : '';
            if (!relPath) continue;

            const fullPath = path.resolve(base, relPath);
            if (!isInside(base, fullPath)) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: `Akses di luar folder project ditolak: ${relPath}` }));
            }

            // Backup file lama jika ada
            if (doBackup && fs.existsSync(fullPath)) {
              const backupPath = path.join(backupDir, relPath);
              fs.mkdirSync(path.dirname(backupPath), { recursive: true });
              fs.copyFileSync(fullPath, backupPath);
            }

            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf8');
            applied.push(relPath);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, applied, backupDir }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      // 10. Kembalikan file ke kondisi git (checkout)
      if (pathname === '/api/files/revert' && req.method === 'POST') {
        const projectPath = (data.projectPath || '').trim();
        const files = Array.isArray(data.files) ? data.files : (Array.isArray(data.paths) ? data.paths : []);

        if (!projectPath || !files.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan files wajib disertakan.' }));
        }

        const args = ['-C', projectPath, 'checkout', '--'].concat(files.map(f => String(f)));
        execFile('git', args, { shell: false }, (err, stdout, stderr) => {
          // Non-zero git result tetap success:true, sertakan stderr
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            reverted: files.map(f => String(f)),
            stdout: stdout || '',
            stderr: stderr || (err ? err.message : '')
          }));
        });
        return;
      }

      // 11. Diff & status git project
      if (pathname === '/api/files/diff' && req.method === 'GET') {
        const projectPath = (parsedUrl.searchParams.get('projectPath') || '').trim();
        if (!projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath wajib disertakan.' }));
        }

        execFile('git', ['-C', projectPath, 'status', '--porcelain'], { shell: false }, (statusErr, statusOut, statusErrOut) => {
          if (statusErr) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: (statusErrOut || statusErr.message || 'Git tidak tersedia atau bukan repository.').trim() }));
          }
          execFile('git', ['-C', projectPath, 'diff', '--no-color'], { shell: false }, (diffErr, diffOut, diffErrOut) => {
            if (diffErr) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: (diffErrOut || diffErr.message || 'Gagal menjalankan git diff.').trim() }));
            }
            const status = statusOut || '';
            // Daftar file untracked dari status --porcelain (baris "?? ")
            const untracked = status.split(/\r?\n/)
              .filter(line => line.startsWith('?? '))
              .map(line => line.substring(3).trim());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, status, diff: diffOut || '', untracked }));
          });
        });
        return;
      }

      // 12. Buka file dengan editor eksternal
      if (pathname === '/api/files/open' && req.method === 'POST') {
        const projectPath = (data.projectPath || '').trim();
        const relPath = (data.filePath || '').trim().replace(/^@/, '');
        const editor = (data.editor || 'antigravity').trim().toLowerCase();
        const allowed = ['antigravity', 'code', 'cursor', 'windsurf', 'subl', 'notepad'];

        if (!projectPath || !relPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'projectPath dan filePath wajib disertakan.' }));
        }
        if (!allowed.includes(editor)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: `Editor tidak dikenal: ${editor}` }));
        }

        const absPath = path.resolve(projectPath, relPath);
        if (!isInside(projectPath, absPath)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Akses di luar folder project ditolak.' }));
        }

        let responded = false;
        const failMissing = () => {
          if (responded) return;
          responded = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Editor tidak ditemukan: ${editor}` }));
        };
        try {
          const child = execFile(editor, [absPath], { shell: false, detached: true });
          child.on('error', failMissing);
          child.on('spawn', () => {
            if (responded) return;
            responded = true;
            if (typeof child.unref === 'function') child.unref();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, editor }));
          });
        } catch (e) {
          failMissing();
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'API route not found' }));
    });
    return;
  }
  let safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(__dirname, safePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h3>404 Not Found</h3><p>File <code>${safePath}</code> tidak ditemukan.</p>`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`500 Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('==============================================================');
  console.log('  🏢 2D Virtual Dev Office & Sprint Manager - Web Server');
  console.log('==============================================================');
  console.log(`\n  Server aktif di:`);
  console.log(`  ➔ Local:   http://localhost:${PORT}`);
  console.log(`  ➔ IP:      http://127.0.0.1:${PORT}`);
  console.log(`\n  Buka alamat di atas di browser Anda (Chrome / Edge / Firefox).`);
  console.log('  Tekan Ctrl + C di terminal untuk menghentikan server.\n');
});
