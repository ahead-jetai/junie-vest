import '@testing-library/jest-dom/vitest'
import {vi} from 'vitest'

// Mock DOM methods not available in jsdom
if (typeof Element !== 'undefined') Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
})
