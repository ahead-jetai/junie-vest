# JunieVest - Personal Finance Assistant

JunieVest is an interactive chat-based financial assistant that provides personalized advice on budgeting, saving, investing, and other personal finance topics. The application features a friendly, conversational interface where users can ask questions and receive helpful financial guidance.

## Features

- **Conversational Interface**: Easy-to-use chat interface for asking financial questions
- **Personalized Financial Advice**: Get guidance on budgeting, saving, investing, and more
- **Real-time Responses**: Powered by OpenAI's GPT-4 through the OpenRouter API
- **Friendly, Accessible Tone**: Financial concepts explained in plain language without jargon

## Project Overview

JunieVest is built with modern web technologies:

- **Frontend**: React 19.1.0 with TypeScript
- **Build Tool**: Vite 7.0.4
- **Testing**: Vitest with React Testing Library
- **API Integration**: OpenRouter API for AI-powered responses

## Getting Started

### Prerequisites

- Node.js (latest LTS version recommended)
- npm or yarn
- OpenRouter API key for AI responses

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/junie-vest.git
   cd junie-vest
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root with your OpenRouter API key:
   ```
   VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
   ```

### Available Scripts

- **Development Server**:
  ```bash
  npm run dev
  ```
  Starts the development server at http://localhost:5173

- **Build for Production**:
  ```bash
  npm run build
  ```
  Compiles TypeScript and builds the application for production

- **Linting**:
  ```bash
  npm run lint
  ```
  Runs ESLint to check for code quality issues

- **Preview Production Build**:
  ```bash
  npm run preview
  ```
  Serves the production build locally for testing

- **Run Tests**:
  ```bash
  npm test          # Run tests in watch mode
  npm run test:ui   # Run tests with UI interface
  npm run test:run  # Run tests once and exit
  ```

## Project Structure

```
src/
├── components/          # React components
│   ├── ChatInterface.tsx  # Main chat interface component
│   └── ChatMessage.tsx    # Individual message component
├── services/            # Business logic and API calls
│   └── chatService.ts     # Handles communication with OpenRouter API
├── data/                # Static data
│   └── mockResponses.json # Mock responses for testing
├── test/                # Test utilities and setup
│   └── setup.ts           # Test configuration
├── App.tsx              # Main application component
└── main.tsx             # Application entry point
```

## Testing

The project uses Vitest with React Testing Library for component testing. Tests are configured in `vite.config.ts` and use the jsdom environment.

To add new tests:
1. Create test files with `.test.tsx` or `.test.ts` extension
2. Place tests alongside source files or in the `src/test/` directory
3. Import testing utilities:
   ```typescript
   import { render } from '@testing-library/react'
   import { describe, it, expect } from 'vitest'
   ```

## Environment Variables

The application requires the following environment variables:

- `VITE_OPENROUTER_API_KEY`: Your OpenRouter API key for accessing AI models

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
