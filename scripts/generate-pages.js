// scripts/generate-pages.js
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

// Рекурсивный поиск ТОЛЬКО .md файлов
function findMarkdownFiles(dir = '.', results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // Пропускаем системные папки и node_modules
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.github') {
        continue;
      }
      findMarkdownFiles(fullPath, results);
    } 
    // Добавляем ТОЛЬКО файлы с расширением .md
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function getFileDate(filePath) {
  try {
    const { data } = await octokit.repos.listCommits({
      owner, repo, path: filePath, per_page: 1
    });
    return data[0]?.commit.committer.date || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// Простой парсер: только **bold** и *italic*
function parseBasicMarkdown(text) {
  // Экранируем HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Заголовки (# ## ###)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // **жирный** и *курсив*
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // `код`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Переносы строк в <p>
  const paragraphs = html.split(/\n\n+/).filter(p => p.trim());
  return paragraphs.map(p => {
    if (p.startsWith('<h')) return p; // заголовки уже оформлены
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

(async () => {
  const files = findMarkdownFiles();
  console.log('📁 Найдено .md файлов:', files.length);
  
  const pages = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const name = path.basename(filePath, '.md');
      
      // Генерация слага: только латиница, цифры, дефисы
      const slug = name.toLowerCase()
        .replace(/[^a-z0-9а-яё\-_\s]/gi, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);
      
      // Категория = первая папка в пути (или 'general')
      const relative = path.relative('.', filePath).replace(/\\/g, '/');
      const parts = relative.split('/');
      const category = parts.length > 1 ? parts[0] : 'general';
      
      // Парсинг заголовка и описания
      const lines = content.split('\n').filter(l => l.trim());
      const firstLine = lines[0] || '';
      const titleMatch = firstLine.match(/^#\s+(.+)$/);
      const title = titleMatch ? titleMatch[1].trim() : name;
      
      // Описание: второй заголовок или первые 120 символов текста
      const descLine = lines.slice(1).find(l => l.trim() && !l.startsWith('#')) || '';
      const description = (descLine || content).replace(/[#*_`]/g, '').trim().slice(0, 140) + '...';
      
      // Контент для отображения (базовый markdown)
      const renderedContent = parseBasicMarkdown(content);
      
      // Текст для поиска (без разметки)
      const searchText = `${title} ${description} ${content.replace(/[#*_`>\[\]()/]/g, ' ')}`.toLowerCase();

      pages.push({
        slug,
        title,
        description,
        category,
        date: await getFileDate(filePath),
        content: renderedContent,
        searchText
      });
      
      console.log(`✅ Обработан: ${filePath}`);
    } catch (err) {
      console.error(`❌ Ошибка обработки ${filePath}:`, err.message);
    }
  }

  // Сортировка: новые сверху
  pages.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  fs.writeFileSync('pages.json', JSON.stringify({ 
    pages, 
    updated: new Date().toISOString(),
    count: pages.length 
  }, null, 2));
  
  console.log(`\n🎉 Готово! pages.json содержит ${pages.length} страниц`);
})();
