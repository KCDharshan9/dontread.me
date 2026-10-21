# dontread.me

A lightweight, browser-based Markdown editor with a live preview and tabs.

Write Markdown on the left, read it on the right. Keep several documents open at once and switch between them without losing your place.

## Features

- Live preview as you type
- Multiple tabs, each keeping its own cursor, scroll position and undo history
- Syntax highlighting and editing by Monaco
- Mermaid diagram rendering
- Resizable split view with optional scroll sync
- Light and dark themes
- Copy to clipboard, export to PDF, reset
- Everything is stored locally and restored when you come back

## Requirements

Node.js 18 or newer.

## Setup

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Build

```sh
npm run build
npm run preview
```

The production build is written to `dist/`.

## Notes

- No account, no server, no analytics. Your documents live in the browser's local storage.
- Clearing site data for the page will remove them.
- Open loads a file into a new tab; it never overwrites what you already have open.

## Credits

This project is a fork of [Markdown Live Preview](https://github.com/tanabe/markdown-live-preview) by [Hideaki Tanabe](https://github.com/tanabe), released under the MIT License. The original work provided the foundation; this fork has been adapted to its own needs.

## License

MIT - see [LICENSE](./LICENSE).
