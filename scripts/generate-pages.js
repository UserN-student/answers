// scripts/generate-pages.js
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { marked } = require('marked');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

function findMarkdownFiles(dir = '.', results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        findMarkdownFiles(fullPath, results);
      }
    } else if (entry.name.endsWith('.md')) {
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

(async () => {
  const files = findMarkdownFiles();
  const pages = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const name = path.basename(filePath, '.md');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const category = path.dirname(filePath) === '.' ? 'general' : path.dirname(filePath).split('/')[0];
    
    // Парсинг frontmatter или первого заголовка
    const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^title:\s*(.+)$/im);
    const title = titleMatch ? titleMatch[1].trim() : name;
    const desc = content.replace(/^#.*\n?/m, '').trim().slice(0, 160) + '...';
    
    // Экранируем для JSON
    const plainText = content.replace(/`{3}[\s\S]*?`{3}/g, '').replace(/[#*_`>\[\]]/g, '');

    pages.push({
      slug,
      title,
      description: desc,
      category,
      date: await getFileDate(filePath),
      content: marked.parse(content),
      searchText: `${title} ${desc} ${plainText}`.toLowerCase()
    });
  }

  pages.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync('pages.json', JSON.stringify({ pages, updated: new Date().toISOString() }, null, 2));
  console.log(`✅ Generated pages.json with ${pages.length} pages`);
})();
