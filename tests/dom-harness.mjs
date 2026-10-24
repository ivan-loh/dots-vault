// Minimal DOM for deterministic UI behavior tests, not a layout/browser substitute.
export function createDOM(ids = []) {
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.attrs = {};
      this.value = '';
      this.hidden = false;
      this.disabled = false;
      this.open = false;
      this.className = '';
      this._text = '';
      this.classList = {
        toggle: (name, on) => {
          const c = new Set(this.className.split(' ').filter(Boolean));
          if (on ?? !c.has(name)) c.add(name);
          else c.delete(name);
          this.className = [...c].join(' ');
        },
        add: (name) => this.classList.toggle(name, true),
        remove: (name) => this.classList.toggle(name, false),
      };
    }
    set textContent(v) {
      this.replaceChildren();
      this._text = String(v);
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'hidden') this.hidden = true;
      if (k === 'disabled') this.disabled = true;
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    append(...children) {
      for (let c of children) {
        if (typeof c === 'string') {
          const t = new Element('#text');
          t._text = c;
          c = t;
        }
        c.parentNode = this;
        this.children.push(c);
      }
    }
    replaceChildren(...c) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this._text = '';
      this.append(...c);
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
    get isConnected() {
      return this === document.body || !!this.parentNode?.isConnected;
    }
    addEventListener(n, fn) {
      (this.listeners[n] ??= []).push(fn);
    }
    emit(n, event = {}) {
      const e = { preventDefault() {}, ...event };
      return Promise.all((this.listeners[n] ?? []).map((fn) => fn(e)));
    }
    focus() {
      document.activeElement = this;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.emit('close');
    }
    querySelectorAll(selector) {
      const tags = selector.split(',').map((t) => t.trim().toUpperCase());
      return this.children.flatMap((c) => [
        ...(tags.includes(c.tagName) ? [c] : []),
        ...c.querySelectorAll(selector),
      ]);
    }
  }
  document = {
    hidden: false,
    listeners: {},
    createElement: (t) => new Element(t),
    createTextNode: (t) => {
      const n = new Element('#text');
      n._text = t;
      return n;
    },
    getElementById: (id) => walk(document.body).find((e) => e.id === id),
    addEventListener(n, fn) {
      (this.listeners[n] ??= []).push(fn);
    },
  };
  document.body = new Element('body');
  for (const id of ids) {
    const e = new Element();
    e.id = id;
    document.body.append(e);
  }
  const window = {
    location: { hash: '' },
    listeners: {},
    addEventListener(n, fn) {
      (this.listeners[n] ??= []).push(fn);
    },
  };
  return {
    document,
    window,
    Node: Element,
    el: (id) => document.getElementById(id),
    async event(target, name, event = {}) {
      await Promise.all((target.listeners[name] ?? []).map((fn) => fn(event)));
    },
  };
}
export function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}
export const tick = () => new Promise((r) => setImmediate(r));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
