import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './style.css'

registerSW({ immediate: true })

// Ask the browser not to evict our IndexedDB under storage pressure.
navigator.storage?.persist?.()

render(<App />, document.getElementById('app')!)
