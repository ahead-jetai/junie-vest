# Junie Wealth Coach - Development Guidelines

## Build/Configuration Instructions

### Project Setup

This is a React + TypeScript project using Vite as the build tool with modern ES modules.

**Key Technologies:**

- React 19.1.0 with TypeScript
- Vite 7.0.4 for build tooling
- ESLint with TypeScript and React plugins
- Vitest for testing with jsdom environment

### Available Scripts

```bash
npm run dev        # Start development server
npm run build      # Build for production (TypeScript compilation + Vite build)
npm run lint       # Run ESLint
npm run preview    # Preview production build
npm run test       # Run tests in watch mode
npm run test:ui    # Run tests with UI interface
npm run test:run   # Run tests once and exit
```

### TypeScript Configuration

The project uses TypeScript project references with separate configurations:

- `tsconfig.json` - Root configuration with project references
- `tsconfig.app.json` - Application code configuration (src/ directory)
- `tsconfig.node.json` - Node.js/build tools configuration (vite.config.ts)

**Key TypeScript Settings:**

- Target: ES2022 (app) / ES2023 (node)
- Strict mode enabled with additional linting rules
- `noUnusedLocals` and `noUnusedParameters` enforced
- Modern module resolution with bundler mode

## Testing Information

### Testing Framework Setup

The project uses **Vitest** with React Testing Library for component testing.

**Testing Dependencies:**

- `vitest` - Test runner
- `@testing-library/react` - React component testing utilities
- `@testing-library/jest-dom` - Additional DOM matchers
- `@testing-library/user-event` - User interaction simulation
- `jsdom` - DOM environment for tests

### Test Configuration

Tests are configured in `vite.config.ts`:

```typescript
test: {
    globals: true,
        environment
:
    'jsdom',
        setupFiles
:
    './src/test/setup.ts',
}
```

### Test Setup File

The `src/test/setup.ts` file includes:

- jest-dom matchers import
- Mock for `scrollIntoView` method (not available in jsdom)

### Running Tests

```bash
# Watch mode (recommended during development)
npm test

# Single run (CI/production)
npm run test:run

# UI mode for interactive testing
npm run test:ui
```

### Adding New Tests

1. Create test files with `.test.tsx` or `.test.ts` extension
2. Place tests alongside source files or in `src/test/` directory
3. Import testing utilities:
   ```typescript
   import { render } from '@testing-library/react'
   import { describe, it, expect } from 'vitest'
   ```

### Example Test Structure

```typescript
import {render} from '@testing-library/react'
import {describe, it, expect} from 'vitest'
import MyComponent from './MyComponent'

describe('MyComponent', () => {
    it('renders without crashing', () => {
        render(<MyComponent / >)
        expect(document.body).toBeInTheDocument()
    })

    it('renders expected content', () => {
        const {container} = render(<MyComponent / >)
        expect(container.firstChild).toBeTruthy()
    })
})
```

## Code Style and Development Information

### ESLint Configuration

The project uses a comprehensive ESLint setup with:

- `@eslint/js` recommended rules
- `typescript-eslint` recommended configuration
- `eslint-plugin-react-hooks` with latest recommended rules
- `eslint-plugin-react-refresh` for Vite integration

**Key Rules:**

- TypeScript strict mode enforcement
- React Hooks rules compliance
- ECMAScript 2020 features
- Browser globals available

### File Structure

```
src/
├── components/          # React components
│   ├── ChatInterface.tsx
│   └── ChatMessage.tsx
├── services/           # Business logic and API calls
│   └── chatService.ts
├── test/              # Test utilities and setup
│   └── setup.ts
├── App.tsx            # Main application component
├── main.tsx           # Application entry point
└── vite-env.d.ts      # Vite type definitions
```

### Development Best Practices

1. **Component Testing**: Always include basic smoke tests for new components
2. **TypeScript**: Leverage strict typing - avoid `any` types
3. **ESLint**: Run linting before commits (`npm run lint`)
4. **DOM Mocking**: Use the provided setup for DOM methods not available in jsdom
5. **Import Organization**: Use ES modules with proper import/export syntax

### Common Issues and Solutions

**Issue**: `scrollIntoView is not a function` in tests
**Solution**: Already handled in `src/test/setup.ts` with mock implementation

**Issue**: ESLint unused variable warnings
**Solution**: Remove unused imports or use underscore prefix for intentionally unused variables

**Issue**: TypeScript compilation errors
**Solution**: Check `tsconfig.app.json` for strict settings and ensure proper typing

### Build Output

- Development: `npm run dev` serves from memory
- Production: `npm run build` outputs to `dist/` directory
- The build process runs TypeScript compilation followed by Vite bundling

---
*Last updated: 2025-07-16*