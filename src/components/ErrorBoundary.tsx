'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
          <div className="text-3xl">⚠️</div>
          <h2 className="text-white font-bold text-sm">Une erreur est survenue</h2>
          <p className="text-gray-500 text-xs max-w-sm">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 bg-[#0055A4] text-white text-xs rounded-lg hover:bg-[#0066c4] transition-colors"
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
