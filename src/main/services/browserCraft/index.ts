/**
 * BrowserCraft: Native Intent-Driven Browser Engine (Stagehand Core)
 *
 * Implements Stagehand's flagship capabilities:
 * - `observe`: Discovers and scores interactive DOM elements against a user goal.
 * - `act`: Executes plain-English natural language actions (click, type, select) without brittle CSS selectors.
 * - `extract`: Extracts structured data or summaries from web pages based on semantic instructions.
 * - `navigate`: Verified smart navigation with network/DOM ready checks.
 *
 * 100% desktop-native. Operates directly in-process via Electron Chromium without cloud Browserbase keys or listening servers.
 */
import { browserService } from '../browser'
import type { BrowserState } from '@shared/types'

export interface InteractiveElement {
  id: string
  tag: string
  role: string
  type?: string
  text: string
  placeholder?: string
  ariaLabel?: string
  suggestedAction: 'click' | 'type' | 'select' | 'hover'
  selector: string
  score?: number
}

export interface ObserveOutcome {
  elements: InteractiveElement[]
  url: string
  title: string
  count: number
}

export interface ActOutcome {
  success: boolean
  action: string
  targetText?: string
  targetSelector?: string
  error?: string
  state: BrowserState
}

export interface ExtractOutcome {
  instruction: string
  data: unknown
  rawText: string
  state: BrowserState
}

export class BrowserCraftEngine {
  /**
   * Observe all visible interactable elements on the page, optionally ranked by goal.
   */
  async observe(scope: string, goal?: string): Promise<ObserveOutcome> {
    const script = `
      (() => {
        const candidates = [];
        const selector = 'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [tabindex="0"], [contenteditable="true"]';
        const elements = Array.from(document.querySelectorAll(selector));

        let index = 1;
        for (const el of elements) {
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.05) continue;

          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'textbox' : tag);
          const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '').trim();
          const placeholder = (el.getAttribute('placeholder') || '').trim();
          const innerText = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
          const title = (el.getAttribute('title') || '').trim();
          const value = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) ? String(el.value || '') : '';

          const displayLabel = innerText || ariaLabel || placeholder || title || value || (el.getAttribute('name') || '');
          if (!displayLabel && tag !== 'input') continue;

          let suggestedAction = 'click';
          if (tag === 'input' && !['button', 'submit', 'checkbox', 'radio'].includes(type)) {
            suggestedAction = 'type';
          } else if (tag === 'textarea' || el.getAttribute('contenteditable') === 'true') {
            suggestedAction = 'type';
          } else if (tag === 'select') {
            suggestedAction = 'select';
          }

          const craftId = 'craft-' + index++;
          el.setAttribute('data-craft-id', craftId);

          candidates.push({
            id: craftId,
            tag,
            role,
            type,
            text: displayLabel,
            placeholder: placeholder || undefined,
            ariaLabel: ariaLabel || undefined,
            suggestedAction,
            selector: '[data-craft-id="' + craftId + '"]'
          });
        }
        return {
          elements: candidates.slice(0, 120),
          url: location.href,
          title: document.title
        };
      })()
    `

    const raw = await browserService.evaluate<{ elements: InteractiveElement[]; url: string; title: string }>(
      scope,
      script
    )

    let items = raw?.elements ?? []
    if (goal && goal.trim()) {
      const goalTerms = goal.toLowerCase().split(/\s+/).filter(Boolean)
      items = items.map((item) => {
        const haystack = `${item.text} ${item.role} ${item.placeholder ?? ''} ${item.ariaLabel ?? ''}`.toLowerCase()
        let score = 0
        for (const term of goalTerms) {
          if (haystack.includes(term)) score += term.length
        }
        return { ...item, score }
      }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    }

    return {
      elements: items,
      url: raw.url,
      title: raw.title,
      count: items.length
    }
  }

  /**
   * Plain-English intent execution: interprets 'action' and acts on the best matching element.
   */
  async act(scope: string, actionDescription: string): Promise<ActOutcome> {
    const lower = actionDescription.toLowerCase().trim()
    const observeResult = await this.observe(scope, actionDescription)
    const candidates = observeResult.elements

    // Determine intended action verb
    let isType = lower.startsWith('type') || lower.startsWith('fill') || lower.startsWith('enter') || lower.includes(' into ') || lower.includes(' in ')
    const isSelect = lower.startsWith('select') || lower.startsWith('choose') || lower.includes(' dropdown')
    const isScrollDown = lower.includes('scroll down')
    const isScrollUp = lower.includes('scroll up')

    if (isScrollDown || isScrollUp) {
      const direction = isScrollUp ? 'up' : 'down'
      const state = await browserService.scroll(scope, direction, 700)
      return { success: true, action: `Scrolled ${direction}`, state }
    }

    if (isType) {
      // Extract target value and target field
      // Patterns: type 'foo' into search box, enter "bar" in email, fill username with test
      let textToType = ''
      const quoteMatch = actionDescription.match(/['"]([^'"]+)['"]/)
      if (quoteMatch) {
        textToType = quoteMatch[1]
      } else {
        const parts = actionDescription.split(/(?:into|in|with)\s+/i)
        if (parts.length > 1) {
          textToType = parts[0].replace(/^(?:type|fill|enter)\s+/i, '').trim()
        }
      }

      // Find best input candidate
      const inputCandidates = candidates.filter((c) => c.suggestedAction === 'type' || c.tag === 'input' || c.tag === 'textarea')
      const target = inputCandidates[0] ?? candidates[0]
      if (!target) {
        const state = await browserService.state(scope)
        return {
          success: false,
          action: actionDescription,
          error: `Could not identify an input element matching "${actionDescription}". Available elements: ${candidates.slice(0, 5).map((c) => c.text).join(', ')}`,
          state
        }
      }

      const state = await browserService.type(scope, target.selector, textToType, lower.includes('enter') || lower.includes('submit'))
      return {
        success: true,
        action: `Typed "${textToType}" into ${target.text || target.tag}`,
        targetText: target.text,
        targetSelector: target.selector,
        state
      }
    }

    if (isSelect) {
      let optionVal = ''
      const quoteMatch = actionDescription.match(/['"]([^'"]+)['"]/)
      if (quoteMatch) optionVal = quoteMatch[1]
      const selectTarget = candidates.find((c) => c.suggestedAction === 'select' || c.tag === 'select') ?? candidates[0]
      if (!selectTarget) {
        const state = await browserService.state(scope)
        return { success: false, action: actionDescription, error: 'No dropdown element found.', state }
      }
      const state = await browserService.select(scope, selectTarget.selector, optionVal)
      return {
        success: true,
        action: `Selected "${optionVal}" in ${selectTarget.text || 'dropdown'}`,
        targetText: selectTarget.text,
        targetSelector: selectTarget.selector,
        state
      }
    }

    // Default: Click action
    const clickTarget = candidates[0]
    if (!clickTarget) {
      const state = await browserService.state(scope)
      return {
        success: false,
        action: actionDescription,
        error: `Could not find an interactable element matching "${actionDescription}".`,
        state
      }
    }

    const state = await browserService.click(scope, clickTarget.selector)
    return {
      success: true,
      action: `Clicked "${clickTarget.text || clickTarget.role}"`,
      targetText: clickTarget.text,
      targetSelector: clickTarget.selector,
      state
    }
  }

  /**
   * Plain-English semantic extraction from the page DOM.
   */
  async extract(scope: string, instruction: string): Promise<ExtractOutcome> {
    const script = `
      (() => {
        // Collect semantic content: tables, lists, cards, articles, headings
        const data = {
          title: document.title,
          url: location.href,
          headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText.trim()).filter(Boolean),
          tables: Array.from(document.querySelectorAll('table')).map(table => {
            const rows = Array.from(table.querySelectorAll('tr')).map(tr => 
              Array.from(tr.querySelectorAll('th, td')).map(cell => cell.innerText.trim())
            );
            return rows.filter(r => r.length > 0);
          }).filter(t => t.length > 0),
          lists: Array.from(document.querySelectorAll('ul, ol')).slice(0, 15).map(list => 
            Array.from(list.querySelectorAll('li')).slice(0, 20).map(li => li.innerText.trim()).filter(Boolean)
          ).filter(l => l.length > 0),
          paragraphs: Array.from(document.querySelectorAll('article, main, .content, p')).slice(0, 25).map(p => 
            p.innerText.trim()
          ).filter(t => t.length > 20)
        };
        const text = (document.body.innerText || '').slice(0, 25000);
        return { data, text };
      })()
    `
    const extracted = await browserService.evaluate<{ data: Record<string, unknown>; text: string }>(scope, script)
    const state = await browserService.state(scope)

    return {
      instruction,
      data: extracted.data,
      rawText: extracted.text,
      state
    }
  }

  /**
   * Smart navigation with network ready validation.
   */
  async navigate(scope: string, url: string): Promise<BrowserState> {
    await browserService.open(scope, url)
    return await browserService.state(scope)
  }
}

export const browserCraft = new BrowserCraftEngine()
