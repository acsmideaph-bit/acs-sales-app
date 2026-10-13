import { Component } from 'react'

// Keeps one broken page from blanking the whole app; shows what failed.
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="panel p-6 max-w-xl">
        <h1 className="text-[17px]">Something went wrong on this page</h1>
        <p className="text-[13px] text-ink-3 mt-2">Reload the page. If it happens again, send this message to the app admin:</p>
        <pre className="mt-3 p-3 bg-canvas rounded text-[12px] whitespace-pre-wrap">{String(this.state.error?.message || this.state.error)}</pre>
        <button className="btn-secondary mt-4" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
