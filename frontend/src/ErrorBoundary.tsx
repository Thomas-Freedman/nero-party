import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-lg font-semibold">UI crashed</div>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-zinc-300">
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
