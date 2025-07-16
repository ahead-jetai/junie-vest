import '@testing-library/jest-dom'
import {vi} from 'vitest'

// Mock DOM methods not available in jsdom
Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
})