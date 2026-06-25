import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualPath = resolve(root, 'docs/user-manual.md');
const outDir = resolve(root, 'docs/dist');
const htmlPath = resolve(outDir, 'user-manual-print.html');
const pdfPath = resolve(outDir, '元衡词元投入产出复盘软件V1.0使用说明手册.pdf');

let tocTargets = [];

if (!existsSync(manualPath)) {
  throw new Error(`Manual not found: ${manualPath}`);
}

mkdirSync(outDir, { recursive: true });

const markdown = readFileSync(manualPath, 'utf8');
writeFileSync(htmlPath, renderHtml(markdown), 'utf8');

const browser = findBrowser();
if (!browser) {
  throw new Error('No Chromium-compatible browser found. Set CHROME_PATH or TOKEN_WORK_BROWSER.');
}

await printPdf(browser, htmlPath, pdfPath);
console.log(pdfPath);

function renderHtml(source) {
  const { cover, bodySource } = splitCover(source);
  const { tocItems, contentSource } = splitToc(bodySource);
  const headingIds = buildHeadingIds(contentSource);
  const toc = renderToc(tocItems, headingIds);
  const body = markdownToHtml(contentSource, headingIds);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>元衡词元投入产出复盘软件 V1.0 使用说明手册</title>
  <style>
    @page { size: A4; margin: 22mm 17mm 18mm; }
    body {
      margin: 0;
      color: #1f2933;
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.64;
    }
    .cover {
      height: 224mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      break-after: page;
      padding-top: 68mm;
    }
    .cover-software {
      font-size: 25pt;
      font-weight: 700;
      letter-spacing: 0;
      line-height: 1.45;
      color: #111827;
      margin: 0 0 13mm;
    }
    .cover-doc {
      font-size: 22pt;
      font-weight: 700;
      line-height: 1.35;
      color: #111827;
      margin: 0 0 28mm;
    }
    .cover-meta {
      width: 82mm;
      margin-top: auto;
      margin-bottom: 20mm;
      font-size: 12pt;
      line-height: 2.1;
      text-align: left;
    }
    .cover-meta-row {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #d1d5db;
    }
    .cover-meta-row span:first-child { color: #4b5563; }
    .toc-page {
      min-height: 224mm;
      box-sizing: border-box;
      break-after: page;
      padding-top: 20mm;
    }
    .toc-title {
      text-align: center;
      font-size: 20pt;
      font-weight: 700;
      margin: 0 0 18mm;
      letter-spacing: 0;
    }
    .toc-list {
      width: 132mm;
      margin: 0 auto;
      font-size: 12pt;
    }
    .toc-row,
    .toc-row:visited {
      display: grid;
      grid-template-columns: auto 1fr 14mm;
      align-items: baseline;
      column-gap: 4mm;
      break-inside: avoid;
      min-height: 9mm;
      color: #111827;
      text-decoration: none;
    }
    .toc-row .toc-dots {
      content: "";
      border-bottom: 1px dotted #9ca3af;
      transform: translateY(-1.2mm);
      min-width: 18mm;
    }
    .toc-row .toc-label,
    .toc-row .toc-page-no {
      background: white;
      color: #111827;
    }
    .toc-row .toc-label { padding-right: 2mm; }
    .toc-row .toc-page-no {
      text-align: right;
      padding-left: 2mm;
      font-variant-numeric: tabular-nums;
    }
    h1, h2, h3 {
      color: #111827;
      line-height: 1.35;
      break-after: avoid;
    }
    h1 {
      text-align: center;
      font-size: 22pt;
      margin: 26mm 0 8mm;
    }
    h2 {
      font-size: 16pt;
      margin: 9mm 0 3.5mm;
      padding-bottom: 2mm;
      border-bottom: 1px solid #d1d5db;
      break-before: auto;
    }
    h1 + p, h1 + table { margin-top: 5mm; }
    h3 {
      font-size: 13pt;
      margin: 5mm 0 1.8mm;
    }
    p { margin: 0 0 2.4mm; }
    ul, ol { margin: 1.5mm 0 3mm 8mm; padding-left: 7mm; }
    li { margin: 0.8mm 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 2.5mm 0 4.2mm;
      break-inside: avoid;
      font-size: 10pt;
    }
    tr { break-inside: avoid; }
    th, td {
      border: 1px solid #cfd6dd;
      padding: 1.8mm 2.2mm;
      vertical-align: top;
    }
    th {
      background: #eef2f5;
      color: #111827;
      font-weight: 700;
    }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 9.5pt;
      background: #f3f4f6;
      padding: 0.3mm 0.9mm;
      border-radius: 2mm;
    }
    pre {
      background: #f6f8fa;
      border: 1px solid #d8dee4;
      margin: 2.5mm 0 4mm;
      padding: 2.5mm;
      white-space: pre-wrap;
      word-break: break-word;
      break-inside: auto;
      font-size: 9pt;
      line-height: 1.36;
    }
    pre code { background: transparent; padding: 0; }
    img {
      display: block;
      max-width: 100%;
      max-height: 132mm;
      object-fit: contain;
      margin: 2.8mm auto 4.5mm;
      border: 1px solid #d1d5db;
      break-inside: avoid;
    }
    a { color: #1f4d7a; text-decoration: none; }
  </style>
</head>
<body>
<section class="cover" aria-label="封面">
  <div class="cover-software">${escapeHtml(cover.softwareName)}</div>
  <div class="cover-doc">${escapeHtml(cover.docName)}</div>
  <div class="cover-meta">
    <div class="cover-meta-row"><span>版本号</span><strong>${escapeHtml(cover.version)}</strong></div>
    <div class="cover-meta-row"><span>编制日期</span><strong>${escapeHtml(cover.date)}</strong></div>
  </div>
</section>
${toc}
${body}
</body>
</html>`;
}

function splitCover(source) {
  const lines = source.split(/\r?\n/);
  let version = 'V1.0';
  let date = '2026 年 6 月';
  let start = 1;

  while (start < lines.length && !lines[start].trim()) start += 1;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (!line) {
      start += 1;
      continue;
    }
    const versionMatch = line.match(/^版本号[:：]\s*(.+?)\s*$/);
    const dateMatch = line.match(/^编制日期[:：]\s*(.+?)\s*$/);
    if (versionMatch) {
      version = versionMatch[1].trim();
      start += 1;
      continue;
    }
    if (dateMatch) {
      date = dateMatch[1].trim();
      start += 1;
      continue;
    }
    break;
  }

  return {
    cover: {
      softwareName: '元衡词元投入产出复盘软件',
      docName: '使用说明手册',
      version,
      date
    },
    bodySource: lines.slice(start).join('\n').trimStart()
  };
}

function splitToc(source) {
  const lines = source.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (!/^##\s+目录\s*$/.test(lines[index] || '')) {
    return { tocItems: [], contentSource: source };
  }
  index += 1;
  const tocItems = [];
  while (index < lines.length) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    const match = line.match(/^\s*-\s+\[([^\]]+)\]\([^)]+\)\s*$/);
    if (match) tocItems.push(match[1]);
    index += 1;
  }
  return {
    tocItems,
    contentSource: lines.slice(index).join('\n').trimStart()
  };
}

function buildHeadingIds(source) {
  const ids = new Map();
  const used = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    const text = match[2].trim();
    const base = slugifyHeading(text);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    ids.set(text, count ? `${base}-${count + 1}` : base);
  }
  return ids;
}

function slugifyHeading(value) {
  const text = String(value || '').trim();
  const ascii = text
    .toLowerCase()
    .replace(/[`*_()[\]{}'"“”‘’]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || `section-${Math.abs(hashCode(text))}`;
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function renderToc(items, headingIds) {
  tocTargets = [];
  if (!items.length) return '';
  return `<section class="toc-page" aria-label="目录">
  <div class="toc-title">目录</div>
  <div class="toc-list">
    ${items.map(item => {
      const id = headingIds.get(item) || slugifyHeading(item);
      tocTargets.push({ id, label: item });
      return `<a class="toc-row" href="#${escapeAttribute(id)}" data-target="${escapeAttribute(id)}"><span class="toc-label">${escapeHtml(item)}</span><span class="toc-dots"></span><span class="toc-page-no">--</span></a>`;
    }).join('\n    ')}
  </div>
</section>`;
}

function markdownToHtml(source, headingIds = new Map()) {
  const lines = source.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let table = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(row => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(row));
    if (rows.length) {
      html.push('<table>');
      rows.forEach((row, index) => {
        const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => inline(cell.trim()));
        const tag = index === 0 ? 'th' : 'td';
        html.push(`<tr>${cells.map(cell => `<${tag}>${cell}</${tag}>`).join('')}</tr>`);
      });
      html.push('</table>');
    }
    table = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```/);
    if (fence) {
      flushParagraph(); flushList(); flushTable();
      if (code) {
        html.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code = { lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph(); flushList(); flushTable();
      continue;
    }
    if (/^\|/.test(line.trim())) {
      flushParagraph(); flushList();
      table.push(line);
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = Math.min(3, heading[1].length);
      const text = heading[2].trim();
      const id = headingIds.get(text) || slugifyHeading(text);
      html.push(`<h${level} id="${escapeAttribute(id)}">${inline(text)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') list = { type: 'ul', items: [] };
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') list = { type: 'ol', items: [] };
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList(); flushTable();
  return html.join('\n');
}

function inline(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const resolved = src.startsWith('assets/') ? resolve(root, 'docs', src) : src;
      return `<img src="${escapeAttribute(pathToFileURL(resolved).href)}" alt="${escapeAttribute(alt)}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function findBrowser() {
  const envBrowser = process.env.TOKEN_WORK_BROWSER || process.env.CHROME_PATH || process.env.CHROME;
  if (envBrowser) return envBrowser;
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  return candidates.find(candidate => process.platform === 'linux' || existsSync(candidate)) || '';
}

function findPython() {
  if (process.env.TOKEN_WORK_PYTHON) {
    if (existsSync(process.env.TOKEN_WORK_PYTHON)) return process.env.TOKEN_WORK_PYTHON;
    throw new Error(`TOKEN_WORK_PYTHON does not exist: ${process.env.TOKEN_WORK_PYTHON}`);
  }
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['-c', 'import pypdf, reportlab'], { stdio: 'ignore' });
    if (result.status === 0) return command;
  }
  throw new Error('Python with pypdf and reportlab is required. Set TOKEN_WORK_PYTHON or install the dependencies.');
}

async function printPdf(browser, html, pdf) {
  const debugPort = await freePort();
  const profileDir = resolve(tmpdir(), `token-work-manual-pdf-${Date.now()}`);
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, { timeoutMs: 30000 });
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    const target = await targetResponse.json();
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
      await waitForManualReady(cdp);
      await updateTocPageNumbers(cdp);
      let previousSignature = '';
      for (let pass = 0; pass < 3; pass += 1) {
        const draftPdf = resolve(tmpdir(), `token-work-manual-draft-${Date.now()}-${pass}.pdf`);
        await writePdf(cdp, draftPdf);
        addDocumentHeaderFooter(draftPdf);
        const realPages = extractTocPages(draftPdf);
        rmSync(draftPdf, { force: true });
        const signature = JSON.stringify(Object.fromEntries(realPages.entries()));
        if (!realPages.size || signature === previousSignature) break;
        previousSignature = signature;
        await updateTocPageNumbers(cdp, realPages);
      }
      await writePdf(cdp, pdf);
      addDocumentHeaderFooter(pdf);
      repairTocLinks(pdf);
    } finally {
      cdp?.close?.();
    }
  } catch (error) {
    error.message = `${error.message}${stderr ? `\n${stderr}` : ''}`;
    throw error;
  } finally {
    await stopChild(chrome);
  }
}

async function writePdf(cdp, outputPath) {
  const printed = await cdp.send('Page.printToPDF', {
    printBackground: true,
    displayHeaderFooter: false,
    marginTop: 0.72,
    marginBottom: 0.62,
    marginLeft: 0.55,
    marginRight: 0.55,
    paperWidth: 8.27,
    paperHeight: 11.69,
    preferCSSPageSize: false
  });
  writeFileSync(outputPath, Buffer.from(printed.result.data, 'base64'));
}

function addDocumentHeaderFooter(pdf) {
  const python = findPython();
  const script = `
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

pdf = Path(sys.argv[1])
overlay = pdf.with_suffix('.header-footer-overlay.pdf')
fixed = pdf.with_suffix('.header-footer-fixed.pdf')

reader = PdfReader(str(pdf))
font_candidates = [
    Path('/Library/Fonts/Arial Unicode.ttf'),
    Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf'),
    Path('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'),
    Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
]
font_path = next((item for item in font_candidates if item.exists()), None)
if font_path:
    pdfmetrics.registerFont(TTFont('ManualHeaderFont', str(font_path)))
    header_font = 'ManualHeaderFont'
else:
    header_font = 'Helvetica'

first_page = reader.pages[0]
width = float(first_page.mediabox.width)
height = float(first_page.mediabox.height)
total = len(reader.pages)
c = canvas.Canvas(str(overlay), pagesize=(width, height))
for page_no in range(1, total + 1):
    if page_no > 1:
        c.setFont(header_font, 7.5)
        c.setFillColor(HexColor('#4b5563'))
        c.drawString(42, height - 22, '元衡词元投入产出复盘软件V1.0')
        c.setStrokeColor(HexColor('#d1d5db'))
        c.setLineWidth(0.5)
        c.line(0, height - 30, width, height - 30)

        c.setFillColor(HexColor('#6b7280'))
        footer = f'第 {page_no} 页 / 共 {total} 页'
        c.drawCentredString(width / 2, 13, footer)
        c.setStrokeColor(HexColor('#e5e7eb'))
        c.line(0, 27, width, 27)
    c.showPage()
c.save()

overlays = PdfReader(str(overlay))
writer = PdfWriter()
for index, current in enumerate(reader.pages):
    if index > 0:
        current.merge_page(overlays.pages[index])
    writer.add_page(current)
with fixed.open('wb') as handle:
    writer.write(handle)
fixed.replace(pdf)
overlay.unlink(missing_ok=True)
`;
  const result = spawnSync(python, ['-c', script, pdf], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to add document header/footer.\n${result.stderr || result.stdout}`);
  }
}

function repairTocLinks(pdf) {
  if (!tocTargets.length) return;
  const python = findPython();
  const script = `
import json, sys, unicodedata
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject

pdf = Path(sys.argv[1])
targets = json.loads(sys.argv[2])
reader = PdfReader(str(pdf))

def norm(value):
    value = unicodedata.normalize('NFKC', str(value or ''))
    value = value.translate(str.maketrans({
        '⻚': '页', '⻅': '见', '⾯': '面', '⽬': '目', '⼊': '入',
        '⽤': '用', '⼯': '工', '⾏': '行', '⼿': '手', '⽂': '文',
        '⼈': '人', '⽇': '日', '⽉': '月', '⼀': '一', '⼆': '二',
        '⼋': '八', '⼗': '十'
    }))
    value = value.replace('、', '').replace('，', '').replace(',', '')
    return ''.join(value.split())

texts = [norm(page.extract_text() or '') for page in reader.pages]
target_pages = []
for target in targets:
    label = norm(target.get('label'))
    page_no = None
    for index, text in enumerate(texts[2:], start=3):
        if label in text:
            page_no = index
            break
    target_pages.append(page_no)

writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

toc_page = writer.pages[1] if len(writer.pages) > 1 else None
annots = list(toc_page.get('/Annots', [])) if toc_page else []
for annot_ref, page_no in zip(annots, target_pages):
    if not page_no or page_no < 1 or page_no > len(writer.pages):
        continue
    annot = annot_ref.get_object()
    if annot.get('/Subtype') != NameObject('/Link'):
        continue
    target_page = writer.pages[page_no - 1]
    top = float(target_page.mediabox.top)
    annot.pop('/Dest', None)
    annot[NameObject('/A')] = DictionaryObject({
        NameObject('/S'): NameObject('/GoTo'),
        NameObject('/D'): ArrayObject([
            target_page.indirect_reference,
            NameObject('/XYZ'),
            FloatObject(0),
            FloatObject(top),
            NumberObject(0)
        ])
    })

tmp = pdf.with_suffix('.toc-links-fixed.pdf')
with tmp.open('wb') as handle:
    writer.write(handle)
tmp.replace(pdf)
`;
  const result = spawnSync(python, ['-c', script, pdf, JSON.stringify(tocTargets)], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to repair table of contents links.\n${result.stderr || result.stdout}`);
  }
}

async function updateTocPageNumbers(cdp, explicitPages = null) {
  const explicitJson = explicitPages
    ? JSON.stringify(Object.fromEntries(explicitPages.entries()))
    : 'null';
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const explicitPages = ${explicitJson};
      const pageHeightPx = document.querySelector('.cover')?.getBoundingClientRect().height || (224 / 25.4 * 96);
      const rows = Array.from(document.querySelectorAll('.toc-row[data-target]'));
      const updated = [];
      for (const row of rows) {
        const target = document.getElementById(row.dataset.target);
        if (!target) continue;
        const top = target.getBoundingClientRect().top + window.scrollY;
        const estimatedPage = Math.max(1, Math.floor(top / pageHeightPx) + 1);
        const page = explicitPages?.[row.dataset.target] || estimatedPage;
        const pageNode = row.querySelector('.toc-page-no');
        if (pageNode) pageNode.textContent = String(page);
        updated.push({ id: row.dataset.target, page });
      }
      return updated;
    })()`,
    returnByValue: true
  });
  const updated = result.result?.value || result.result?.result?.value || [];
  if (!updated.length) {
    throw new Error('Could not calculate table of contents page numbers.');
  }
  await sleep(100);
}

function extractTocPages(pdf) {
  const python = findPython();
  const script = `
import json, sys, unicodedata
from pathlib import Path
from pypdf import PdfReader

pdf = Path(sys.argv[1])
targets = json.loads(sys.argv[2])
reader = PdfReader(str(pdf))

def norm(value):
    value = unicodedata.normalize('NFKC', str(value or ''))
    value = value.translate(str.maketrans({
        '⻚': '页', '⻅': '见', '⾯': '面', '⽬': '目', '⼊': '入',
        '⽤': '用', '⼯': '工', '⾏': '行', '⼿': '手', '⽂': '文',
        '⼈': '人', '⽇': '日', '⽉': '月', '⼀': '一', '⼆': '二',
        '⼋': '八', '⼗': '十'
    }))
    value = value.replace('、', '').replace('，', '').replace(',', '')
    return ''.join(value.split())

texts = [norm(page.extract_text() or '') for page in reader.pages]
out = {}
for target in targets:
    label = norm(target['label'])
    for index, text in enumerate(texts[2:], start=3):
        if label in text:
            out[target['id']] = index
            break
print(json.dumps(out, ensure_ascii=False))
`;
  const result = spawnSync(python, ['-c', script, pdf, JSON.stringify(tocTargets)], { encoding: 'utf8' });
  if (result.status !== 0) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(result.stdout || '{}')));
  } catch {
    return new Map();
  }
}

async function waitForManualReady(cdp) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Array.from(document.images).every(img => img.complete)`,
      returnByValue: true
    });
    if (result.result?.value || result.result?.result?.value) return;
    await sleep(100);
  }
  throw new Error('Timed out while waiting for manual HTML to load.');
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on('error', reject);
  });
}

async function waitForJson(url, { timeoutMs }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', rejectOpen, { once: true });
  });

  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callbacks.resolve(message);
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
      });
    },
    close() {
      ws.close();
    }
  };
}

async function stopChild(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolveStop => child.once('exit', resolveStop)),
    sleep(1500).then(() => {
      if (!child.killed) child.kill('SIGKILL');
    })
  ]);
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}
