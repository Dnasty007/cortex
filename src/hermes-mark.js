import { notebookEntries } from './notebook.js'
import * as empty from './owner-mark.empty.js'

let owner = empty
try {
  const href = new URL('./owner-mark.local.js', import.meta.url).href
  owner = await import(/* @vite-ignore */ href)
} catch {
  owner = empty
}

export { notebookEntries }
export const SPINE_ID = owner.SPINE_ID || ''
export const isHermesBrain = typeof owner.isHermesBrain === 'function' ? owner.isHermesBrain : empty.isHermesBrain
export const stampHermes = typeof owner.stampHermes === 'function' ? owner.stampHermes : empty.stampHermes
