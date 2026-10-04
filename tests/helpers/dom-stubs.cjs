// Browser stand-ins shared by the Node test files: the app modules are classic
// scripts that expect `window`, `document`, `localStorage`, and friends.
// Deliberately sloppy-mode: assigning Node's getter-only `global.navigator` must
// stay a silent no-op, exactly as it was when this lived in app.test.js.

function setupDomStubs() {
  const noop = () => {};

  const createClassList = () => ({
    add: noop,
    remove: noop,
    toggle: noop,
    contains: () => false,
  });

  const createStyle = () =>
    new Proxy(
      {},
      {
        get: () => '',
        set: () => true,
        has: () => false,
      },
    );

  function createElementStub() {
    const classList = createClassList();
    const style = createStyle();
    const element = {
      classList,
      style,
      dataset: {},
      textContent: '',
      innerHTML: '',
      appendChild: noop,
      removeChild: noop,
      append: noop,
      remove: noop,
      focus: noop,
      blur: noop,
      click: noop,
      insertAdjacentHTML: noop,
      setAttribute: noop,
      removeAttribute: noop,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      addEventListener: noop,
      removeEventListener: noop,
      querySelector: () => createElementStub(),
      querySelectorAll: () => [],
      scrollIntoView: noop,
      contains: () => false,
    };

    return new Proxy(element, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'innerHTML') {
          // Simulate browser's HTML escaping behavior
          const text = target.textContent || '';
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }
        if (prop === 'outerHTML' || prop === 'textContent') return target.textContent || '';
        if (prop === 'value') return target.value ?? '';
        if (prop === 'checked') return false;
        if (prop === Symbol.iterator) {
          return function* () {};
        }
        return noop;
      },
      set(target, prop, value) {
        if (prop === 'textContent') {
          target.textContent = value;
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  }

  const body = createElementStub();
  const documentElement = createElementStub();
  const head = createElementStub();

  const documentStub = {
    body,
    documentElement,
    head,
    title: '',
    readyState: 'loading',
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    createElement: () => createElementStub(),
    createElementNS: () => createElementStub(),
    createDocumentFragment: () => createElementStub(),
    createTextNode: () => createElementStub(),
    createRange: () => ({
      selectNodeContents: noop,
      setStart: noop,
      setEnd: noop,
      collapse: noop,
    }),
    execCommand: noop,
  };

  const storageMap = new Map();
  const storage = {
    getItem: key => (storageMap.has(key) ? storageMap.get(key) : null),
    setItem: (key, value) => storageMap.set(key, String(value)),
    removeItem: key => storageMap.delete(key),
    clear: () => storageMap.clear(),
    key: index => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  };

  const navigatorStub = {
    userAgent: 'node-test',
    clipboard: { writeText: noop },
    serviceWorker: {
      controller: null,
      addEventListener: noop,
      ready: Promise.resolve({}),
      register: () => Promise.resolve({}),
    },
  };

  const windowStub = {
    document: documentStub,
    localStorage: storage,
    navigator: navigatorStub,
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 2,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    requestAnimationFrame: cb => setTimeout(cb, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: noop,
    confirm: () => false,
    scrollTo: noop,
    location: { href: 'http://localhost/', reload: noop, assign: noop },
    matchMedia: () => ({
      matches: false,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
    }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    performance: { now: () => Date.now() },
    crypto: { getRandomValues: array => array.fill(0) },
  };

  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

  global.window = windowStub;
  global.document = documentStub;
  global.localStorage = storage;
  global.navigator = navigatorStub;
  global.getComputedStyle = windowStub.getComputedStyle;
  global.self = windowStub;
  global.globalThis = global;

  return { documentStub, storage, windowStub };
}

// Persistent, id-addressed elements for tests that need a screen to keep its state between
// calls (an open sheet that redraws). Returns get(id) and restore(); call restore() when done.
function installLiveDocument() {
  const previous = global.document;
  const elements = new Map();
  let active = null;
  const make = id => {
    const attributes = new Map();
    const classes = new Set(['hidden']);
    const element = {
      id, innerHTML: '', textContent: '', scrollTop: 0, scrollLeft: 0, value: '', dataset: {},
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      hasAttribute: name => attributes.has(name),
      getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
      setAttribute: (name, value) => { attributes.set(name, String(value)); },
      removeAttribute: name => { attributes.delete(name); },
      addEventListener() {}, removeEventListener() {},
      focus() { active = element; },
      contains: other => other === element,
      querySelector: () => null, querySelectorAll: () => [],
    };
    return element;
  };
  const get = id => {
    if (!elements.has(id)) elements.set(id, make(id));
    return elements.get(id);
  };
  const live = Object.create(previous, { activeElement: { get: () => active } });
  live.getElementById = get;
  live.querySelector = () => null;
  live.querySelectorAll = () => [];
  global.document = live;
  return { get, has: id => elements.has(id), restore() { global.document = previous; } };
}

module.exports = { setupDomStubs, installLiveDocument };
