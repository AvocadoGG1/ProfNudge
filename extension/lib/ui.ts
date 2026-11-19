/** Tiny DOM helpers for the in-page UI. Everything renders inside a shadow root so RMP's CSS can't leak in. */

export const BRAND = '#3b5bdb';

export const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button { cursor: pointer; font: inherit; }
.btn { border: 0; border-radius: 999px; padding: 8px 16px; font-weight: 600; font-size: 14px; }
.btn-primary { background: ${BRAND}; color: #fff; }
.btn-primary:disabled { opacity: .5; cursor: default; }
.btn-ghost { background: transparent; color: #333; border: 1px solid #ccc; }
.btn-tracked { background: #e7f5ec; color: #1e7b45; }
.card { background: #fff; color: #111; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); padding: 20px; }
label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; color: #333; }
input[type=text], input[type=email], input[type=date], select, textarea {
  width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px; color: #111; background: #fff;
}
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { border: 1px solid #ccc; background: #fff; color: #333; border-radius: 999px; padding: 6px 12px; font-size: 13px; }
.chip.on { background: ${BRAND}; border-color: ${BRAND}; color: #fff; }
.muted { color: #666; font-size: 12px; }
.err { color: #c92a2a; font-size: 13px; margin-top: 8px; }
.ok { color: #1e7b45; font-size: 13px; margin-top: 8px; }
`;

export function mountShadow(host: HTMLElement, css: string): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BASE_CSS + css;
  root.append(style);
  return root;
}

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/** Chip group where at most `max` can be on. */
export function chips<T extends string>(options: readonly T[], selected: Set<T>, max: number, onChange: () => void) {
  const wrap = h('div', { class: 'row' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: 'chip' }, o);
    const sync = () => b.classList.toggle('on', selected.has(o));
    b.addEventListener('click', () => {
      if (selected.has(o)) selected.delete(o);
      else if (max === 1) {
        selected.clear();
        selected.add(o);
      } else if (selected.size < max) selected.add(o);
      wrap.querySelectorAll('button').forEach((x) => x.dispatchEvent(new Event('sync')));
      onChange();
    });
    b.addEventListener('sync', sync);
    sync();
    wrap.append(b);
  }
  return wrap;
}
