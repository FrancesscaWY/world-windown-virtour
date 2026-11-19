/** Small, safe Markdown renderer. All text is DOM text; raw HTML/images never execute. */
export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function markdownInline(doc, source, depth = 0) {
  const fragment = doc.createDocumentFragment();
  if (depth > 5) { fragment.append(doc.createTextNode(source)); return fragment; }
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    fragment.append(doc.createTextNode(source.slice(end, match.index)));
    const tag = match[1] ? 'code' : match[2] ? 'a' : match[4] || match[5] ? 'strong' : match[6] ? 'del' : 'em';
    const node = doc.createElement(tag);
    if (tag === 'a') {
      const href = safeLink(match[3]);
      if (href) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      node.append(markdownInline(doc, match[2], depth + 1));
    } else node.append(tag === 'code' ? doc.createTextNode(match[1]) : markdownInline(doc, match[4] || match[5] || match[6] || match[7] || match[8], depth + 1));
    fragment.append(node); end = match.index + match[0].length;
  }
  fragment.append(doc.createTextNode(source.slice(end)));
  return fragment;
}

export function renderMarkdown(doc, source) {
  const root = doc.createElement('div'); root.className = 'message-body markdown-body';
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').slice(0, 30000).split('\n');
  const append = (tag, text, target = root) => {
    const node = doc.createElement(tag); node.append(markdownInline(doc, text)); target.append(node); return node;
  };
  const special = line => /^(?:\s*$| {0,3}(?:#{1,6} |>|```|~~~|[-*+] |\d+[.)] ))/.test(line);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^ {0,3}(```+|~~~+)(.*)$/);
    if (fence) {
      const code = []; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) code.push(lines[i++]);
      i++; const pre = doc.createElement('pre'), node = doc.createElement('code');
      node.textContent = code.join('\n'); pre.append(node); root.append(pre); continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (heading) { append(`h${Math.min(6, heading[1].length + 2)}`, heading[2]); i++; continue; }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { root.append(doc.createElement('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      append('blockquote', quote.join('\n')); continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (list) {
      const node = doc.createElement(list[2] ? 'ol' : 'ul');
      if (list[2]) node.start = Number(list[2]);
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
        if (!item || Boolean(item[2]) !== Boolean(list[2])) break;
        append('li', item[3], node); i++;
      }
      root.append(node); continue;
    }
    // Tables scroll inside the message instead of expanding the page.
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const wrapper = doc.createElement('div'); wrapper.className = 'markdown-table';
      const table = doc.createElement('table'), head = doc.createElement('thead'), body = doc.createElement('tbody');
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').slice(0, 12);
      const row = (text, header, target) => { const tr = doc.createElement('tr'); cells(text).forEach(cell => append(header ? 'th' : 'td', cell.trim(), tr)); target.append(tr); };
      row(line, true, head); i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) row(lines[i++], false, body);
      table.append(head, body); wrapper.append(table); root.append(wrapper); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && !special(lines[i])) paragraph.push(lines[i++]);
    append('p', paragraph.join('\n'));
  }
  return root;
}
