import { Component, type ReactNode } from 'react';

/**
 * Keeps a crash inside the Designer editor from replacing the page with the router error screen:
 * the fallback (with "export my JSON") is rendered instead, so unsaved work is never lost.
 * Nothing is logged (the error may quote configuration; spec §17).
 */
export class DesignerErrorBoundary extends Component<
  { fallback: (reset: () => void) => ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }));
    return this.props.children;
  }
}
