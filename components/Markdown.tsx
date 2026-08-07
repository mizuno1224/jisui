"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * レシピカードの本文を表示する。
 * カードは「なぜその工程が必要か」まで書かれた長文なので、
 * 見出しと本文の差をはっきりさせて、台所で目を離しても迷子にならないようにする。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: () => null, // 料理名は画面上部に出しているので本文では省く
          h2: ({ children }) => (
            <h2 className="mt-7 mb-2 border-l-4 border-emerald-500 pl-2 text-base font-bold text-neutral-900 dark:text-neutral-50">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 mb-1.5 text-[15px] font-bold text-emerald-800 dark:text-emerald-300">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 space-y-1.5 pl-1">{children}</ul>,
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:size-1.5 before:rounded-full before:bg-neutral-300 marker:hidden dark:before:bg-neutral-600">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-neutral-900 dark:text-neutral-50">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[13px] dark:bg-neutral-800">
              {children}
            </code>
          ),
          hr: () => <hr className="my-6 border-neutral-200 dark:border-neutral-800" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-neutral-200 px-2 py-1 text-left font-semibold dark:border-neutral-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-neutral-100 px-2 py-1 dark:border-neutral-800">
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
