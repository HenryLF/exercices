import MarkdownIt from 'markdown-it';

// Raw HTML is escaped, so admin-written markdown can't inject scripts; markdown-it also refuses
// javascript: and data: links by default.
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });

export function renderMarkdown(source: string): string {
  return md.render(source);
}
