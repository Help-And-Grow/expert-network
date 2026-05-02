import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { initStore } from './shared/store'
import { initCloudBase } from './shared/cloudbase'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    initCloudBase()
    initStore()
  })

  // children 是将要会渲染的页面
  return children
}

export default App
