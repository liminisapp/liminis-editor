/**
 * File type detection utilities for determining how to render files in the editor.
 */

export type FileType = 'markdown' | 'image' | 'pdf' | 'mermaid' | 'code' | 'remarkable-document' | 'unknown'

/**
 * Determine the file type based on path and extension.
 * @param path - The file path to check
 * @returns The detected file type
 */
export function getFileType(path: string | null): FileType {
  if (!path) return 'unknown'

  const ext = path.toLowerCase().split('.').pop() || ''

  // Check for remarkable document - files inside a remarkable document folder
  // Structure: remarkable/DocName/document.pdf, remarkable/DocName/pages/page_001.png, etc.
  // But NOT remarkable/index.md (which is the section index markdown)
  if (path.startsWith('remarkable/')) {
    const parts = path.split('/')
    // parts[0] = 'remarkable', parts[1] = DocName or filename
    // If parts.length >= 3, it's inside a document folder (e.g., remarkable/DocName/document.pdf)
    // If parts.length === 2 and NOT a markdown file, treat as remarkable document folder
    if (parts.length >= 3) {
      return 'remarkable-document'
    }
    // parts.length === 2: remarkable/something - check if it's the index.md or a doc folder reference
    if (parts.length === 2 && !['md', 'mdc'].includes(ext)) {
      return 'remarkable-document'
    }
    // Fall through to normal extension checking for remarkable/index.md
  }

  if (['md', 'mdc'].includes(ext)) return 'markdown'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'mmd') return 'mermaid'
  // Text and data files - use code type for syntax highlighting (aligned with EditorColumn)
  if (['txt', 'log', 'csv', 'json', 'xml', 'yml', 'yaml'].includes(ext)) return 'code'
  // Code file extensions
  const codeExtensions = ['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'go', 'rb', 'php', 'sh', 'bash', 'mjs', 'mts', 'zsh']
  if (codeExtensions.includes(ext)) return 'code'

  return 'unknown'
}

/**
 * Normalise a wiki-link / transclusion target to the URL form carried on a
 * link node: a target with a recognised extension is kept as-is, anything else
 * gets `.md` appended (`[[page]]` -> `page.md`). Shared by the mapper and the
 * transclusion renderer so `[[file#^id]]` and `![[file#^id]]` hand the host the
 * same `url` shape.
 */
export function wikiTargetToUrl(target: string): string {
  return getFileType(target) !== 'unknown' ? target : `${target}.md`
}

/**
 * Full wiki-link target -> URL derivation, covering the anchor and directory
 * forms the bare {@link wikiTargetToUrl} does not: `#anchor` and `dir/` are
 * kept, `page#anchor` becomes `page.md#anchor`. Shared by the mapper's inline
 * wiki-link conversion and the transclusion renderer's nested links, so a link
 * inside transcluded content navigates to the same URL as a top-level one.
 */
export function wikiLinkTargetToUrl(target: string): string {
  // Anchor-only (#anchor) and directory links (trailing slash) are preserved;
  // the navigation layer resolves directories to index.md / README.md.
  if (target.startsWith('#') || target.endsWith('/')) return target
  if (target.includes('#')) {
    const [path, anchor] = target.split('#', 2)
    // Directory with anchor: preserve for the navigation layer
    if (path.endsWith('/')) return target
    return `${wikiTargetToUrl(path)}#${anchor}`
  }
  return wikiTargetToUrl(target)
}
