import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'
import { Icon } from './icons'

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = extractText(children)
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          })
        }}
        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
        aria-label="Copy code"
      >
        {copied ? <Icon name="confirm" size="sm" /> : <Icon name="copy" size="sm" />}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

export function Markdown({
  content,
  streaming,
  className
}: {
  content: string
  streaming?: boolean
  className?: string
}) {
  return (
    <div className={cn('md', streaming && 'stream-caret', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
