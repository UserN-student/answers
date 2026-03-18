const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { marked } = require('marked');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

// Настройки marked
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: true,
  mangle: false,
  sanitize: false,
  smartLists: true,
  smartypants: false
});

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
  } catch { 
    return new Date().toISOString(); 
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

(async () => {
  console.log('🔍 Поиск markdown файлов...');
  const files = findMarkdownFiles();
  console.log(`📁 Найдено файлов: ${files.length}`);
  
  const pages = [];
  for (const filePath of files) {
    try {
      console.log(`\n📄 Обработка: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf8');
      const name = path.basename(filePath, '.md');
      
      // Slug
      const slug = name.toLowerCase()
        .replace(/[^a-z0-9а-яё\-_\s]/gi, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);
      
      // Категория
      const relative = path.relative('.', filePath).replace(/\\/g, '/');
      const parts = relative.split('/');
      const category = parts.length > 1 ? parts[0] : 'general';
      
      // Заголовок и описание
      const lines = content.split('\n').filter(l => l.trim());
      const firstLine = lines[0] || '';
      const titleMatch = firstLine.match(/^#\s+(.+)$/);
      const title = titleMatch ? titleMatch[1].trim() : name;
      
      const descLine = lines.slice(1).find(l => l.trim() && !l.startsWith('#')) || '';
      const descHtml = marked.parse(descLine);
      const description = stripHtml(descHtml).slice(0, 160) + '...';
      
      // РЕНДЕРИНГ MARKDOWN В HTML
      console.log('  🔄 Рендеринг markdown...');
      const renderedContent = marked.parse(content);
      console.log(`  ✅ HTML сгенерирован (${renderedContent.length} символов)`);
      
      // Текст для поиска
      const searchText = `${title} ${description} ${stripHtml(renderedContent)}`.toLowerCase();

      pages.push({
        slug,
        title,
        description,
        category,
        date: await getFileDate(filePath),
        content: renderedContent,
        searchText,
        rawContent: content
      });
      
    } catch (err) {
      console.error(`  ❌ Ошибка: ${err.message}`);
    }
  }

  pages.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const output = {
    pages,
    updated: new Date().toISOString(),
    count: pages.length
  };
  
  fs.writeFileSync('pages.json', JSON.stringify(output, null, 2));
  console.log(`\n🎉 Готово! pages.json: ${pages.length} страниц`);
  
  // Проверка первого элемента
  if (pages.length > 0) {
    console.log('\n📋 Пример контента (первые 200 символов):');
    console.log(pages[0].content.substring(0, 200));
  }
})();
