# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## News API Integration

This frontend can fetch news articles dynamically for the Discover page.

- Configure environment variables (create an `.env` from `.env.example`):
  - `VITE_NEWS_API_KEY`: Your NewsAPI key.
  - `VITE_NEWS_API_URL` (optional): A full endpoint, e.g. `https://newsapi.org/v2/top-headlines?country=us&pageSize=50`.
- Where it’s used:
  - Fetch logic in [src/services/newsApi.ts](src/services/newsApi.ts)
  - Rendering in [src/components/Discover/DiscoverView.tsx](src/components/Discover/DiscoverView.tsx)
- Behavior:
  - If `VITE_NEWS_API_URL` is set, the app will request it and include `apiKey` if provided.
  - If only `VITE_NEWS_API_KEY` is set, it will call NewsAPI `top-headlines` directly.
  - If neither returns data, it falls back to mocked sample articles for development.

### Setup & Run

1. Copy the example env and edit values:
   ```powershell
   Copy-Item .env.example .env
   # Edit .env with your key and optional URL
   ```
2. Install and start:
   ```powershell
   npm ci
   npm run dev
   ```
3. Optional build:
   ```powershell
   npm run build
   ```

### Notes

- For production, consider proxying NewsAPI via your backend to avoid exposing the API key and to control caching/CORS.
- Control how many Discover feed blocks render via the `feedCount` prop on `DiscoverView` (defaults to 2).
