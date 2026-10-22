import Storehouse from 'storehouse-js';
import * as monaco from 'monaco-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

const init = () => {
    let scrollBarSync = false;

    const localStorageNamespace = 'com.markdownlivepreview';
    const localStorageKey = 'last_state';
    const localStorageScrollBarKey = 'scroll_bar_settings';
    const localStorageThemeKey = 'theme_settings';
    const localStorageTabsKey = 'tabs_index';
    const tabContentKeyPrefix = 'tab_content_';
    const storeExpiry = new Date(2099, 1, 1);
    const confirmationMessage = 'Are you sure you want to reset? Your changes will be lost.';
    let mermaidRenderTimer = null;
    let mermaidRenderVersion = 0;

    let tabs = [];
    let activeId = null;
    let tabSequence = 0;
    let pendingPreviewScroll = null;
    // default template
    const defaultInput = `# Welcome to dontread.me

Write Markdown on the left, see it rendered on the right.

## Headings

# Heading one
## Heading two
### Heading three

## Text

*Italic*, **bold**, ***both***, and ~~crossed out~~.

## Lists

- First item
- Second item
  - Nested item
  - Another nested item

1. Step one
2. Step two
   1. Sub-step
   2. Sub-step

## Quote

> Write first, edit later.
>
> > Every draft starts rough.

## Table

| Feature | Works |
| ------- | :---: |
| Preview |  Yes  |
| Tabs    |  Yes  |
| Themes  |  Yes  |

## Code

\`\`\`js
const message = 'Hello, world';
console.log(message);
\`\`\`

## Diagram

\`\`\`mermaid
graph LR
  Draft --> Review
  Review --> Publish
\`\`\`

## Image

![Markdown mark](/image/Markdown-mark.svg "A sample image")

## Link

Start writing at [dontread.me](https://dontread-me.vercel.app/).
`;

    self.MonacoEnvironment = {
        getWorker(_, label) {
            return new Proxy({}, { get: () => () => { } });
        }
    }

    let setupEditor = () => {
        let editor = monaco.editor.create(document.querySelector('#editor'), {
            model: null,
            fontSize: 14,
            language: 'markdown',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            scrollbar: {
                vertical: 'visible',
                horizontal: 'visible'
            },
            wordWrap: 'on',
            hover: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            folding: false
        });

        editor.onDidChangeModelContent(() => {
            let value = editor.getValue();
            convert(value);
            saveActiveContent(value);
        });

        editor.onDidScrollChange((e) => {
            if (!scrollBarSync) {
                return;
            }

            const scrollTop = e.scrollTop;
            const scrollHeight = e.scrollHeight;
            const height = editor.getLayoutInfo().height;

            const maxScrollTop = scrollHeight - height;
            const scrollRatio = scrollTop / maxScrollTop;

            let previewElement = document.querySelector('#preview');
            let targetY = (previewElement.scrollHeight - previewElement.clientHeight) * scrollRatio;
            previewElement.scrollTo(0, targetY);
        });

        return editor;
    };

    let escapeHtml = (value) => {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    let createMarkedRenderer = () => {
        const renderer = new marked.Renderer();
        const renderCode = renderer.code.bind(renderer);

        renderer.code = (token) => {
            const lang = (token.lang || '').match(/^\S*/)?.[0].toLowerCase();
            if (lang !== 'mermaid') {
                return renderCode(token);
            }

            return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        };

        return renderer;
    };

    let configureMermaid = (theme) => {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme,
            suppressErrorRendering: true,
        });
    };

    let showMermaidError = (element, error) => {
        const message = error && error.message ? error.message : 'Unable to render Mermaid chart.';
        element.classList.add('mermaid-error');
        element.textContent = `Mermaid render error: ${message}`;
    };

    let getMermaidTheme = () => {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
    };

    let renderMermaidDiagramsNow = async (theme = getMermaidTheme()) => {
        const outputElement = document.querySelector('#output');
        if (!outputElement) {
            return;
        }

        const version = ++mermaidRenderVersion;
        configureMermaid(theme);

        const elements = Array.from(outputElement.querySelectorAll('.mermaid'));
        for (const [index, element] of elements.entries()) {
            if (version !== mermaidRenderVersion) {
                return;
            }

            const source = element.dataset.mermaidSource || element.textContent;
            element.dataset.mermaidSource = source;
            element.classList.remove('mermaid-error');

            try {
                const renderId = `mermaid-${Date.now()}-${version}-${index}`;
                const { svg, bindFunctions } = await mermaid.render(renderId, source, element);
                if (version !== mermaidRenderVersion) {
                    return;
                }
                element.innerHTML = svg;
                if (typeof bindFunctions === 'function') {
                    bindFunctions(element);
                }
            } catch (error) {
                showMermaidError(element, error);
            }
        }

        // Diagrams can change the page height after the switch, so restore
        // the remembered preview position once they have settled.
        if (pendingPreviewScroll !== null) {
            const previewElement = document.querySelector('#preview');
            if (previewElement) {
                previewElement.scrollTop = pendingPreviewScroll;
            }
            pendingPreviewScroll = null;
        }
    };

    let scheduleMermaidRender = () => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
        }

        mermaidRenderTimer = setTimeout(() => {
            mermaidRenderTimer = null;
            renderMermaidDiagramsNow();
        }, 150);
    };

    let renderMermaidDiagrams = (theme) => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
            mermaidRenderTimer = null;
        }

        return renderMermaidDiagramsNow(theme);
    };

    let renderer = createMarkedRenderer();

    // Render markdown text as html
    let convert = (markdown) => {
        let options = {
            headerIds: false,
            mangle: false,
            renderer
        };
        let html = marked.parse(markdown, options);
        let sanitized = DOMPurify.sanitize(html);
        document.querySelector('#output').innerHTML = sanitized;
        scheduleMermaidRender();
    };

    // Reset input text
    let reset = () => {
        const tab = getActiveTab();
        let changed = editor.getValue() != defaultInput;
        if ((tab && tab.dirty) || changed) {
            var confirmed = window.confirm(confirmationMessage);
            if (!confirmed) {
                return;
            }
        }
        presetValue(defaultInput);
        document.querySelectorAll('.column').forEach((element) => {
            element.scrollTo({ top: 0 });
        });
    };

    let presetValue = (value) => {
        editor.setValue(value);
        editor.revealPosition({ lineNumber: 1, column: 1 });
        editor.focus();
        let tab = getActiveTab();
        if (tab) {
            tab.dirty = false;
        }
    };

    // ----- sync scroll position -----

    let initScrollBarSync = (settings) => {
        let checkbox = document.querySelector('#sync-scroll-checkbox');
        checkbox.checked = settings;
        scrollBarSync = settings;

        checkbox.addEventListener('change', (event) => {
            let checked = event.currentTarget.checked;
            scrollBarSync = checked;
            saveScrollBarSettings(checked);
        });
    };

    // ----- preview CSS loader (switch github-markdown css) -----
    const PREVIEW_CSS_LIGHT = 'css/github-markdown-light.css?v=e3dc51b8a261';
    const PREVIEW_CSS_DARK = 'css/github-markdown-dark_dimmed.css?v=df221bf84b9d';

    let setPreviewCss = (useDark) => {
        const link = document.getElementById('gh-markdown-link');
        const desired = useDark ? PREVIEW_CSS_DARK : PREVIEW_CSS_LIGHT;
        if (!link) {
            const newLink = document.createElement('link');
            newLink.id = 'gh-markdown-link';
            newLink.rel = 'stylesheet';
            newLink.href = desired;
            document.head.appendChild(newLink);
            return new Promise((resolve) => {
                newLink.addEventListener('load', resolve, { once: true });
                newLink.addEventListener('error', resolve, { once: true });
            });
        }

        if (link.getAttribute('href') === desired) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
            link.setAttribute('href', desired);
        });
    };

    // ----- theme toggle (dark/light) -----
    let setTheme = (enabled) => {
        document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    };

    let initThemeToggle = (settings) => {
        let checkbox = document.querySelector('#theme-checkbox');
        if (!checkbox) return;
        checkbox.checked = settings;
        setTheme(settings);

        // set Monaco editor theme to match page theme
        if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
            monaco.editor.setTheme(settings ? 'vs-dark' : 'vs');
        }
        // set preview css to match theme
        setPreviewCss(settings);

        checkbox.addEventListener('change', (event) => {
            let checked = event.currentTarget.checked;
            setTheme(checked);
            saveThemeSettings(checked);
            setPreviewCss(checked);
            if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
                monaco.editor.setTheme(checked ? 'vs-dark' : 'vs');
            }
            renderMermaidDiagrams();
        });
    };

    // ----- clipboard utils -----

    let copyToClipboard = (text, successHandler, errorHandler) => {
        navigator.clipboard.writeText(text).then(
            () => {
                successHandler();
            },

            () => {
                errorHandler();
            }
        );
    };

    let notifyCopied = () => {
        let labelElement = document.querySelector("#copy-button a");
        labelElement.innerHTML = "Copied!";
        setTimeout(() => {
            labelElement.innerHTML = "Copy";
        }, 1000)
    };

    // ----- export preview -----

    let restoreMermaidThemeAfterPrint = (theme) => {
        const printMedia = window.matchMedia('print');
        let printSessionStarted = false;

        const cleanup = () => {
            printMedia.removeEventListener('change', handlePrintMediaChange);
        };

        const handlePrintMediaChange = (event) => {
            if (event.matches) {
                printSessionStarted = true;
                return;
            }

            if (!printSessionStarted) {
                return;
            }

            cleanup();
            renderMermaidDiagrams(theme);
        };

        printMedia.addEventListener('change', handlePrintMediaChange);
        return cleanup;
    };

    let exportPreviewToPdf = () => {
        const currentTheme = getMermaidTheme();
        const printTheme = 'default';

        const cleanupPrintThemeListener = currentTheme === 'dark'
            ? restoreMermaidThemeAfterPrint(currentTheme)
            : null;

        renderMermaidDiagrams(printTheme).then(() => {
            window.print();
        }).catch((error) => {
            console.error('Failed to prepare PDF export', error);
            if (currentTheme === 'dark') {
                cleanupPrintThemeListener();
                renderMermaidDiagrams(currentTheme);
            }
            window.alert('Unable to prepare the print preview. Please try again.');
        });
    };

    // ----- setup -----

    // setup navigation actions
    let setupOpenButton = () => {
        const button = document.querySelector('#open-button');
        const input = document.querySelector('#open-file-input');

        button.addEventListener('click', () => {
            input.click();
        });

        input.addEventListener('change', async () => {
            const file = input.files[0];
            // Allow the same file to be selected again, including after a failed read.
            input.value = '';
            if (!file) return;

            button.disabled = true;
            let content;
            try {
                content = await file.text();
            } catch (error) {
                window.alert('Unable to read this file. Please try again.');
                return;
            } finally {
                button.disabled = false;
            }

            addTab(content, titleFromFilename(file.name));
            document.querySelector('#preview').scrollTo({ top: 0 });
        });
    };

    let setupResetButton = () => {
        document.querySelector("#reset-button").addEventListener('click', (event) => {
            event.preventDefault();
            reset();
        });
    };

    let setupCopyButton = (editor) => {
        document.querySelector("#copy-button").addEventListener('click', (event) => {
            event.preventDefault();
            let value = editor.getValue();
            copyToClipboard(value, () => {
                notifyCopied();
            },
                () => {
                    // nothing to do
                });
        });
    };

    let setupExportButton = () => {
        const exportButton = document.querySelector('#export-button');
        if (!exportButton) {
            return;
        }
        exportButton.addEventListener('click', (event) => {
            event.preventDefault();
            exportPreviewToPdf();
        });
    };

    // ----- local state -----

    let loadLastContent = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageKey);
        return lastContent;
    };

    let loadScrollBarSettings = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageScrollBarKey);
        return lastContent;
    };

    let loadThemeSettings = () => {
        let last = Storehouse.getItem(localStorageNamespace, localStorageThemeKey);
        if (last === null || last === undefined) {
            try {
                // fallback to raw localStorage boot key used by inline script
                const raw = localStorage.getItem('com.markdownlivepreview_theme');
                if (raw === 'dark') return true;
                if (raw === 'light') return false;
            } catch (e) {
                // ignore
            }

            // Nothing stored yet: start from the system preference.
            try {
                return window.matchMedia('(prefers-color-scheme: dark)').matches;
            } catch (e) {
                return false;
            }
        }
        return last;
    };

    let saveScrollBarSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageScrollBarKey, settings, expiredAt);
    };

    let saveThemeSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageThemeKey, settings, expiredAt);
        try {
            localStorage.setItem('com.markdownlivepreview_theme', settings ? 'dark' : 'light');
        } catch (e) {
            // ignore storage errors
        }
    };

    // ----- documents (tabs) -----

    let storeSet = (key, value) => {
        Storehouse.setItem(localStorageNamespace, key, value, storeExpiry);
    };

    let storeGet = (key) => {
        return Storehouse.getItem(localStorageNamespace, key);
    };

    let storeDelete = (key) => {
        Storehouse.deleteItem(localStorageNamespace, key);
    };

    let tabContentKey = (id) => {
        return tabContentKeyPrefix + id;
    };

    let getTab = (id) => {
        return tabs.find((tab) => tab.id === id) || null;
    };

    let getActiveTab = () => {
        return getTab(activeId);
    };

    let nextUntitledTitle = () => {
        let n = 1;
        while (tabs.some((tab) => tab.title === 'Untitled ' + n)) {
            n += 1;
        }
        return 'Untitled ' + n;
    };

    let uniqueTitle = (base) => {
        if (!tabs.some((tab) => tab.title === base)) {
            return base;
        }
        let n = 2;
        while (tabs.some((tab) => tab.title === base + ' (' + n + ')')) {
            n += 1;
        }
        return base + ' (' + n + ')';
    };

    let titleFromFilename = (name) => {
        let base = String(name || '').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '').trim();
        return base || 'Untitled';
    };

    let persistTabsIndex = () => {
        storeSet(localStorageTabsKey, {
            activeId: activeId,
            tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title }))
        });
    };

    let loadTabsIndex = () => {
        let index;
        try {
            index = storeGet(localStorageTabsKey);
        } catch (error) {
            return null;
        }

        if (!index || typeof index !== 'object' || !Array.isArray(index.tabs) || index.tabs.length === 0) {
            return null;
        }

        let entries = index.tabs
            .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
            .map((entry) => ({
                id: entry.id,
                title: typeof entry.title === 'string' && entry.title ? entry.title : 'Untitled'
            }));

        if (entries.length === 0) {
            return null;
        }

        return { activeId: index.activeId, tabs: entries };
    };

    let createTab = (content, title, id) => {
        tabSequence += 1;
        let tab = {
            id: id || 't' + tabSequence + '-' + Date.now().toString(36),
            title: title,
            model: monaco.editor.createModel(content, 'markdown'),
            viewState: null,
            previewScrollTop: 0,
            dirty: false
        };
        tabs.push(tab);
        storeSet(tabContentKey(tab.id), content);
        return tab;
    };

    let saveActiveContent = (content) => {
        let tab = getActiveTab();
        if (!tab) {
            return;
        }
        tab.dirty = true;
        storeSet(tabContentKey(tab.id), content);
        // Kept in sync so an older build can still open the active document.
        storeSet(localStorageKey, content);
    };

    let renderTabBar = () => {
        let list = document.querySelector('#tablist');
        if (!list) {
            return;
        }

        list.textContent = '';

        tabs.forEach((tab) => {
            let isActive = tab.id === activeId;

            let element = document.createElement('div');
            element.className = isActive ? 'tab active' : 'tab';
            element.setAttribute('role', 'tab');
            element.setAttribute('aria-selected', isActive ? 'true' : 'false');
            element.tabIndex = isActive ? 0 : -1;
            element.dataset.id = tab.id;
            element.title = tab.title;

            let label = document.createElement('span');
            label.className = 'tab-title';
            label.textContent = tab.title;

            let close = document.createElement('button');
            close.type = 'button';
            close.className = 'tab-close';
            close.title = 'Close';
            close.setAttribute('aria-label', 'Close ' + tab.title);
            close.textContent = '\u00d7';

            element.appendChild(label);
            element.appendChild(close);
            list.appendChild(element);
        });
    };

    let persistActiveView = () => {
        let tab = getActiveTab();
        if (!tab) {
            return;
        }

        try {
            tab.viewState = editor.saveViewState();
        } catch (error) {
            tab.viewState = null;
        }

        let previewElement = document.querySelector('#preview');
        if (previewElement) {
            tab.previewScrollTop = previewElement.scrollTop;
        }
    };

    let activateTab = (id, options) => {
        let settings = options || {};
        let next = getTab(id);

        if (!next) {
            return;
        }

        if (id === activeId) {
            if (settings.focus !== false) {
                editor.focus();
            }
            return;
        }

        persistActiveView();

        let value = next.model.getValue();
        activeId = id;
        editor.setModel(next.model);

        if (next.viewState) {
            try {
                editor.restoreViewState(next.viewState);
            } catch (error) {
                // stale view state for this model — start from the top
            }
        }

        convert(value);
        pendingPreviewScroll = next.previewScrollTop || 0;

        let previewElement = document.querySelector('#preview');
        if (previewElement) {
            previewElement.scrollTop = pendingPreviewScroll;
        }

        storeSet(tabContentKey(next.id), value);
        storeSet(localStorageKey, value);
        persistTabsIndex();
        renderTabBar();

        if (settings.focus !== false) {
            editor.focus();
        }
    };

    let addTab = (content, baseTitle) => {
        let title = baseTitle ? uniqueTitle(baseTitle) : nextUntitledTitle();
        let tab = createTab(content, title);
        activateTab(tab.id);
        return tab;
    };

    let closeTab = (id) => {
        let tab = getTab(id);
        if (!tab) {
            return;
        }

        if (tab.model.getValue().trim() !== '') {
            if (!window.confirm('Close "' + tab.title + '"? Its content will be lost.')) {
                return;
            }
        }

        let index = tabs.indexOf(tab);
        let wasActive = id === activeId;

        if (wasActive) {
            let neighbour = tabs[index + 1] || tabs[index - 1] || null;
            activeId = null;
            if (neighbour) {
                activateTab(neighbour.id, { focus: false });
            } else {
                editor.setModel(null);
            }
        }

        tabs = tabs.filter((entry) => entry.id !== id);

        try {
            tab.model.dispose();
        } catch (error) {
            // model already detached from the editor
        }

        storeDelete(tabContentKey(id));

        if (tabs.length === 0) {
            let fresh = createTab('', nextUntitledTitle());
            activateTab(fresh.id, { focus: false });
            return;
        }

        persistTabsIndex();
        renderTabBar();
    };

    let setupTabBar = () => {
        let list = document.querySelector('#tablist');
        let addButton = document.querySelector('#tab-new');

        if (addButton) {
            addButton.addEventListener('click', () => {
                addTab('', null);
            });
        }

        if (!list) {
            return;
        }

        list.addEventListener('click', (event) => {
            let tabElement = event.target.closest('.tab');
            if (!tabElement) {
                return;
            }

            if (event.target.closest('.tab-close')) {
                closeTab(tabElement.dataset.id);
                return;
            }

            activateTab(tabElement.dataset.id);
        });

        list.addEventListener('keydown', (event) => {
            let tabElement = event.target.closest('.tab');
            if (!tabElement) {
                return;
            }

            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateTab(tabElement.dataset.id);
                return;
            }

            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                let index = tabs.findIndex((tab) => tab.id === tabElement.dataset.id);
                if (index === -1) {
                    return;
                }

                event.preventDefault();
                let offset = event.key === 'ArrowRight' ? 1 : -1;
                let target = tabs[(index + offset + tabs.length) % tabs.length];
                activateTab(target.id, { focus: false });

                let focused = list.querySelector('.tab.active');
                if (focused) {
                    focused.focus();
                }
            }
        });

        // The strip hides its scrollbar, so let the wheel move it sideways.
        list.addEventListener('wheel', (event) => {
            if (event.deltaY === 0 || list.scrollWidth <= list.clientWidth) {
                return;
            }
            list.scrollLeft += event.deltaY;
            event.preventDefault();
        }, { passive: false });
    };

    let initTabs = () => {
        let index = loadTabsIndex();

        if (index) {
            index.tabs.forEach((entry) => {
                let content = storeGet(tabContentKey(entry.id));
                createTab(typeof content === 'string' ? content : '', entry.title, entry.id);
            });

            let target = tabs.some((tab) => tab.id === index.activeId) ? index.activeId : tabs[0].id;
            activateTab(target);
            return;
        }

        // First run after the upgrade: adopt the single-document state as tab one.
        let legacyContent = loadLastContent();
        let seed = typeof legacyContent === 'string' ? legacyContent : defaultInput;
        let tab = createTab(seed, nextUntitledTitle());
        activateTab(tab.id);
    };

    let setupDivider = () => {
        let lastLeftRatio = 0.5;
        const divider = document.getElementById('split-divider');
        const leftPane = document.getElementById('edit');
        const rightPane = document.getElementById('preview');
        const container = document.getElementById('container');

        let isDragging = false;

        divider.addEventListener('mouseenter', () => {
            divider.classList.add('hover');
        });

        divider.addEventListener('mouseleave', () => {
            if (!isDragging) {
                divider.classList.remove('hover');
            }
        });

        divider.addEventListener('mousedown', () => {
            isDragging = true;
            divider.classList.add('active');
            document.body.style.cursor = 'col-resize';
        });

        divider.addEventListener('dblclick', () => {
            const containerRect = container.getBoundingClientRect();
            const totalWidth = containerRect.width;
            const dividerWidth = divider.offsetWidth;
            const halfWidth = (totalWidth - dividerWidth) / 2;

            leftPane.style.width = halfWidth + 'px';
            rightPane.style.width = halfWidth + 'px';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            document.body.style.userSelect = 'none';
            const containerRect = container.getBoundingClientRect();
            const totalWidth = containerRect.width;
            const offsetX = e.clientX - containerRect.left;
            const dividerWidth = divider.offsetWidth;

            // Prevent overlap or out-of-bounds
            const minWidth = 100;
            const maxWidth = totalWidth - minWidth - dividerWidth;
            const leftWidth = Math.max(minWidth, Math.min(offsetX, maxWidth));
            leftPane.style.width = leftWidth + 'px';
            rightPane.style.width = (totalWidth - leftWidth - dividerWidth) + 'px';
            lastLeftRatio = leftWidth / (totalWidth - dividerWidth);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                divider.classList.remove('active');
                divider.classList.remove('hover');
                document.body.style.cursor = 'default';
                document.body.style.userSelect = '';
            }
        });

        window.addEventListener('resize', () => {
            const containerRect = container.getBoundingClientRect();
            const totalWidth = containerRect.width;
            const dividerWidth = divider.offsetWidth;
            const availableWidth = totalWidth - dividerWidth;

            const newLeft = availableWidth * lastLeftRatio;
            const newRight = availableWidth * (1 - lastLeftRatio);

            leftPane.style.width = newLeft + 'px';
            rightPane.style.width = newRight + 'px';
        });
    };

    // ----- entry point -----
    let editor = setupEditor();
    setupTabBar();
    initTabs();
    setupOpenButton();
    setupResetButton();
    setupCopyButton(editor);
    setupExportButton();

    let scrollBarSettings = loadScrollBarSettings() || false;
    initScrollBarSync(scrollBarSettings);

    // initialize theme (dark/light)
    let themeSettings = loadThemeSettings();
    // normalize to boolean (Storehouse may return string or boolean)
    if (themeSettings === 'true' || themeSettings === true) {
        themeSettings = true;
    } else {
        themeSettings = false;
    }
    initThemeToggle(themeSettings);

    setupDivider();
};

window.addEventListener("load", () => {
    init();
});
