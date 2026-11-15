// Bảng hướng dẫn cú pháp định dạng tin nhắn Telegram (tĩnh — chỉ phụ thuộc ngôn ngữ).
import React from 'react'
import { Table } from 'antd'
import { useTranslation } from 'react-i18next'

/** Khối Lắng nghe Telegram: cú pháp HTML dùng trong câu trả lời tự động. */
export function ListenerSyntaxTable() {
  const { t } = useTranslation()
  return (
    <Table
      size="small"
      pagination={false}
      columns={[
        { title: t('blockEditor.tableFuncCol'), dataIndex: 'func', key: 'func', width: '25%' },
        { title: t('blockEditor.tableHtmlSyntaxCol'), dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
        { title: t('blockEditor.tableResultCol'), dataIndex: 'result', key: 'result', width: '35%' }
      ]}
      dataSource={[
        { key: 1, func: t('blockEditor.fnBold'), syntax: '<b>text</b>', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
        { key: 2, func: t('blockEditor.fnItalic'), syntax: '<i>text</i>', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
        { key: 3, func: t('blockEditor.fnUnderline'), syntax: '<u>text</u>', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
        { key: 4, func: t('blockEditor.fnStrike'), syntax: '<s>text</s>', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
        { key: 5, func: t('blockEditor.fnLink'), syntax: '<a href="http://example.com/">Link name</a>', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
        { key: 6, func: t('blockEditor.fnInlineCode'), syntax: '<code>text</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
        { key: 7, func: t('blockEditor.fnCodeBlock'), syntax: '<pre>text</pre>', result: t('blockEditor.resCodeBlockGray') },
        { key: 8, func: t('blockEditor.fnQuote'), syntax: '<blockquote>text</blockquote>', result: t('blockEditor.resQuoteIndent') },
        { key: 9, func: t('blockEditor.fnSpoiler'), syntax: '<tg-spoiler>text</tg-spoiler>', result: t('blockEditor.resSpoilerBlur') },
      ]}
    />
  )
}

/** Khối Gửi Telegram: cú pháp theo parse mode đang chọn (HTML / MarkdownV2). */
export function SendSyntaxTable({ parseMode }) {
  const { t } = useTranslation()
  const telegramParseMode = parseMode
  return (
    <Table
      size="small"
      pagination={false}
      columns={[
        { title: t('blockEditor.tableFuncCol'), dataIndex: 'func', key: 'func', width: '22%' },
        { title: telegramParseMode === 'MarkdownV2' ? t('blockEditor.tableMarkdownSyntaxCol') : t('blockEditor.tableHtmlSyntaxCol'), dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
        { title: t('blockEditor.tableResultCol'), dataIndex: 'result', key: 'result', width: '38%' }
      ]}
      dataSource={telegramParseMode === 'MarkdownV2' ? [
        { key: 1, func: t('blockEditor.fnBold'), syntax: '*text*', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
        { key: 2, func: t('blockEditor.fnItalic'), syntax: '_text_', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
        { key: 3, func: t('blockEditor.fnUnderline'), syntax: '__text__', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
        { key: 4, func: t('blockEditor.fnStrike'), syntax: '~text~', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
        { key: 5, func: t('blockEditor.fnLink'), syntax: '[Link name](http://example.com/)', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
        { key: 6, func: t('blockEditor.fnMention'), syntax: '[User Name](tg://user?id=123456789)', result: <a href="#">{t('blockEditor.resMentionClick')}</a> },
        { key: 7, func: t('blockEditor.fnInlineCode'), syntax: '`text`', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
        { key: 8, func: t('blockEditor.fnCodeBlock'), syntax: '```\ntext\n```', result: t('blockEditor.resCodeBlockGray') },
        { key: 9, func: t('blockEditor.fnCodeBlockLang'), syntax: '```python\nprint("Hello")\n```', result: t('blockEditor.resCodeBlockHighlight') },
        { key: 10, func: t('blockEditor.fnQuote'), syntax: '>text', result: t('blockEditor.resQuoteIndent') },
        { key: 11, func: t('blockEditor.fnSpoiler'), syntax: '||text||', result: t('blockEditor.resSpoilerBlur') },
      ] : [
        { key: 1, func: t('blockEditor.fnBold'), syntax: '<b>text</b>', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
        { key: 2, func: t('blockEditor.fnItalic'), syntax: '<i>text</i>', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
        { key: 3, func: t('blockEditor.fnUnderline'), syntax: '<u>text</u>', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
        { key: 4, func: t('blockEditor.fnStrike'), syntax: '<s>text</s>', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
        { key: 5, func: t('blockEditor.fnBoldItalic'), syntax: '<b><i>text</i></b>', result: <strong><em>{t('blockEditor.resBoldText')}</em></strong> },
        { key: 6, func: t('blockEditor.fnLink'), syntax: '<a href="http://example.com/">Link name</a>', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
        { key: 7, func: t('blockEditor.fnMention'), syntax: '<a href="tg://user?id=123456789">User Name</a>', result: <a href="#">{t('blockEditor.resMentionClick')}</a> },
        { key: 8, func: t('blockEditor.fnInlineCode'), syntax: '<code>text</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
        { key: 9, func: t('blockEditor.fnCodeBlock'), syntax: '<pre>text</pre>', result: t('blockEditor.resCodeBlockGray') },
        { key: 10, func: t('blockEditor.fnCodeBlockLang'), syntax: '<pre><code class="language-python">print("Hello")</code></pre>', result: t('blockEditor.resCodeBlockHighlight') },
        { key: 11, func: t('blockEditor.fnQuote'), syntax: '<blockquote>text</blockquote>', result: t('blockEditor.resQuoteIndent') },
        { key: 12, func: t('blockEditor.fnSpoiler'), syntax: '<tg-spoiler>text</tg-spoiler>', result: t('blockEditor.resSpoilerBlur') },
      ]}
    />
  )
}
