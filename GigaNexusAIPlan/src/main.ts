import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import './styles/base.css'

// vite --mode arch(npm run arch):只載入架構圖,不含甘特圖進度與編輯
if (import.meta.env.MODE === 'arch') {
  document.title = 'GigaNexus 架構圖'
  import('./ArchApp.vue').then(({ default: ArchApp }) => createApp(ArchApp).mount('#app'))
} else {
  import('./App.vue').then(({ default: App }) => createApp(App).use(createPinia()).mount('#app'))
}
