import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed inside ErrorBoundary', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <h1>PAGE-AUTO gặp lỗi giao diện</h1>
          <p>Hãy đóng và mở lại ứng dụng. Chi tiết kỹ thuật được giữ ngoài vùng dữ liệu tài khoản.</p>
        </main>
      )
    }

    return this.props.children
  }
}
