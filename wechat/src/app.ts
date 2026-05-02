import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { initStore } from './shared/store'
import { wxLogin, isLoggedIn } from './shared/auth'
import { initCloudBase } from './shared/cloudbase'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    initCloudBase()
    initStore()

    if (!isLoggedIn()) {
      wxLogin().catch((err) => {
        console.warn('[App] auto-login failed:', err)
      })
    }
  })

  // children 是将要会渲染的页面
  return children
}

export default App
