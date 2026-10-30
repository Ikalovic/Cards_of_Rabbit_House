import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  // Each test owns a fresh database, just as localStorage is cleared below.
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})
