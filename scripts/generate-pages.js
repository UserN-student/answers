const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

function findMarkdownFiles(dir = '.', results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.github') continue;
      findMarkdownFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function getFileDate(filePath) {
  try {
    const { data } = await octokit.repos.listCommits({ owner, repo, path: filePath, per_page: 1 });
    return data[0]?.commit.committer.date || new Date().toISOString();
  } catch { return new Date().toISOString(); }
}

// ПОЛНОЦЕННЫЙ MARKDOWN ПАРСЕР
function parseMarkdown(text) {
  let html = text;
  
  // Экранирование HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Заголовки
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Жирный и курсив
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Код
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Ссылки и изображения
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Цитаты
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  
  // Списки
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // Таблицы
  const tableRegex = /^((?:\|.+\|\n)+)(?:\|\s*[-:]+\s*(?:\|\s*[-:]+\s*)+\|)\n((?:\|.+\|\n?)+)/gm;
  html = html.replace(tableRegex, (match, headers, rows) => {
    const headerCells = headers.match(/\|([^\|]+)\|/g).map(c => c.replace(/\|/g, '').trim());
    const rowCells = rows.trim().split('\n').map(row => 
      row.match(/\|([^\|]+)\|/g).map(c => c.replace(/\|/g, '').trim())
    );
    
    return `<table><thead><tr>${headerCells.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowCells.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  });
  
  // Горизонтальная линия
  html = html.replace(/^---+$/gm, '<hr>');
  html = html.replace(/^\*\*\*+$/gm, '<hr>');
  
  // Переносы строк в параграфы
  const blocks = html.split(/\n\n+/).filter(b => b.trim());
  html = blocks.map(block => {
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') || 
        block.startsWith('<blockquote') || block.startsWith('<table') || block.startsWith('<pre') || 
        block.startsWith('<hr')) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  
  return html;
}

(async () => {
  const files = findMarkdownFiles();
  console.log('📁 Найдено .md файлов:', files.length);
  
  const pages = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const name = path.basename(filePath, '.md');
      const slug = name.toLowerCase().replace(/[^a-z0-9а-яё\-_\s]/gi, '').replace(/[\s_]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
      
      const relative = path.relative('.', filePath).replace(/\\/g, '/');
      const parts = relative.split('/');
      const category = parts.length > 1 ? parts[0] : 'general';
      
      const lines = content.split('\n').filter(l => l.trim());
      const firstLine = lines[0] || '';
      const titleMatch = firstLine.match(/^#\s+(.+)$/);
      const title = titleMatch ? titleMatch[1].trim() : name;
      
      const descLine = lines.slice(1).find(l => l.trim() && !l.startsWith('#')) || '';
      const description = (descLine || content).replace(/[#*_`>\[\]()]/g, '').trim().slice(0, 160) + '...';
      
      const renderedContent = parseMarkdown(content);
      const searchText = `${title} ${description} ${content.replace(/[#*_`>\[\]()\/\\]/g, ' ')}`.toLowerCase();

      pages.push({ slug, title, description, category, date: await getFileDate(filePath), content: renderedContent, searchText });
      console.log(`✅ ${filePath}`);
    } catch (err) { console.error(`❌ ${filePath}:`, err.message); }
  }

  pages.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync('pages.json', JSON.stringify({ pages, updated: new Date().toISOString(), count: pages.length }, null, 2));
  console.log(`\n🎉 pages.json: ${pages.length} страниц`);
})();
