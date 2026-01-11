# AGENTS.md

This file provides guidelines for agentic coding agents working in this repository.

## Project Overview

A static website for displaying Chinese character stroke order animations using HanziWriter.
- Pure HTML/CSS/JavaScript with no build system
- Uses HanziWriter 3.5 via CDN
- Supports up to 10 characters per session with sequential playback
- Responsive design with mobile support
- Kid-friendly UI with playful colors and animations

## Build/Test/Lint Commands

This project has no build system, package.json, tests, or linting configured.

### Running locally:
```bash
# Python
python3 -m http.server 8000

# Node.js
npx http-server -p 8000
```

### Deployment:
```bash
./deploy.sh <server> <remote_dir>
# Example: ./deploy.sh user@server.com /opt/app
```

### No automated testing
- Manual testing required: open in browser, verify character rendering and playback

### No linting/formatting tools
- No ESLint, Prettier, or similar configured
- Follow the existing code style in js/app.js and css/style.css

## Code Style Guidelines

### JavaScript (js/app.js)

- Use ES6+ classes for main application logic (`HanziStrokeApp`)
- Store writers in `Map`, not plain objects
- Naming: PascalCase for classes, camelCase for methods/variables
- DOM elements: Store in `this.dom` object with descriptive names
- Event handlers: Prefix with `handle` or keep descriptive
- Function order: `constructor()`, `init()`, `cacheDOM()`, `bindEvents()`, `handle*()`, `render*()`, helpers
- Always use `async/await` for promises, add `finally` blocks to cleanup state
- Error handling: Use `console.error()` with emoji prefixes (❌ error, ⚠️ warning)
- DOM: Use `document.getElementById()`/`createElement()`, dynamic IDs with `${type}-${uniqueId}`
- State: Use `isPlaying`, `isRendering` flags to prevent concurrent operations
- Logging: Use emoji prefixes (✅ success, ❌ error, ⚠️ warning), include context

### CSS (css/style.css)

- Organization: Global reset, base styles, sections, components, utilities, media queries
- Naming: kebab-case for classes (`.character-card`), camelCase for IDs (`#charInput`)
- Styling: CSS Grid for layouts, Flexbox for internals, transitions (`0.3s`)
- Mobile-first: default styles for mobile, `@media (min-width)` for desktop
- Units: `rem` for typography, `px` for fixed sizes, `%` for responsive widths
- Kid-friendly: Use rounded corners (15-20px), gradients, bright colors (#ff6b6b, #ffe66d), and playful animations
- Animations: `bounce` for active cards, `pulse` for placeholder, hover effects with scale/rotate transforms

### HTML (index.html)

- Semantic HTML5: `<header>`, `<main>`/`.container`, `<footer>`
- Load scripts at end of `<body>`, CSS in `<head>`
- Set `lang="zh-CN"`, Chinese UI text, English code comments
- Accessibility: `for` attributes on labels, `aria` attributes where needed, keyboard navigation
- Title: "给小朋友用的笔顺工具" (Stroke order tool for kids)

## Project-Specific Patterns

### Chinese Character Handling
- Filter: `value.replace(/[^\u4e00-\u9fa5]/g, '')`
- Limit: `value.slice(0, 10)`
- Handle loading failures gracefully

### HanziWriter Integration
- Load before creating: `await HanziWriter.loadCharacterData(char)`
- Create with config: `{ width: 120, height: 120, strokeColor: '#333' }`
- Store writers in Map

### Color Scheme (Kid-Friendly)
- Primary red: #ff6b6b
- Primary yellow: #ffe66d
- Background gradient: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)
- Card hover: Scale (1.05) with rotate(1deg)
- Active cards: Bounce animation, red border
- Grid lines: Yellow (#ffe66d) with 3px width, rounded

### Animation Sequencing
- Sync loading: `await this.waitForWriter(uniqueId)`
- Delay: `await this.delay(1000)`
- Smooth scroll: `card.scrollIntoView({ behavior: 'smooth', block: 'center' })`

## Deployment

Static site - deploy by copying files:
- Vercel/Netlify: Drag and drop folder
- Custom server: Use `deploy.sh` script
- GitHub Pages: Push to `gh-pages` branch

## Key Dependencies

- HanziWriter 3.5 CDN: `https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js`
- No npm packages or build tools

## Browser Support

- Chrome 60+, Firefox 60+, Safari 12+, Edge 79+
- Mobile: iOS Safari, Chrome Mobile
- No polyfills

## Common Tasks

### Adding a new feature
1. Check if HanziWriter supports it
2. Add method to `HanziStrokeApp` class
3. Add UI in `index.html`
4. Style in `css/style.css`
5. Test manually in browser

### Fixing a bug
1. Add `console.log()` with context
2. Check browser DevTools console
3. Verify HanziWriter API usage
4. Test with multiple characters

### Modifying styles
1. Check existing CSS classes
2. Update in `css/style.css`
3. Test mobile responsiveness
4. Ensure no layout breaks

## Notes

- No automated tests - manual verification required
- No linting - follow existing style patterns
- Chinese comments encouraged
- Console logging is extensive and intentional
- State flags prevent race conditions
