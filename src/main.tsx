import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { resumeSession } from './server'
import { installTracking } from './sync'
import './style.css'

registerSW({ immediate: true })

// Ask the browser not to evict our IndexedDB under storage pressure.
navigator.storage?.persist?.()

installTracking()
resumeSession().catch(console.error)

render(<App />, document.getElementById('app')!)
