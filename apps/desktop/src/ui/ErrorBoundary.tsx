/** 화면 오류가 나도 창이 하얗게 비지 않게: 무엇이 잘못됐는지 + 다시 열기. 기록은 보관함에 그대로 있음 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("화면 오류", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <b>화면을 그리다 문제가 생겼어요</b>
        <p>기록은 안전하게 저장돼 있어요. 다시 열면 대부분 괜찮아져요.</p>
        <pre className="other" style={{ maxWidth: 520, whiteSpace: "pre-wrap", textAlign: "left" }}>{String(this.state.error.message)}</pre>
        <button className="btn btn-accent" onClick={() => location.reload()}>다시 열기</button>
      </div>
    );
  }
}
