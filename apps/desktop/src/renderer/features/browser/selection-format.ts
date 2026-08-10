import type { BrowserSelection } from '@pi-desktop/protocol';

/**
 * Turn a picker payload into Composer text the model can act on.
 * Modifications still go through workspace edit tools — this is context only.
 */
export function formatBrowserSelectionForComposer(selection: BrowserSelection): string {
  const lines = [
    'Selected from the browser preview (update the source that renders this UI):',
    `- URL: ${selection.url}`,
    `- Selector: \`${selection.selector}\``,
    `- Tag: \`${selection.tagName}\``,
  ];
  if (selection.title?.trim()) {
    lines.push(`- Page title: ${selection.title.trim()}`);
  }
  const text = selection.text.trim();
  if (text) {
    lines.push('- Text:', '```', text, '```');
  }
  const html = selection.htmlSnippet.trim();
  if (html) {
    lines.push('- HTML snippet:', '```html', html, '```');
  }
  return `${lines.join('\n')}\n`;
}
