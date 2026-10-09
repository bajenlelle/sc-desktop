/**
 * Remounts on every navigation between the signed-out pages, so each one
 * fades in (globals.css .auth-enter) while the frame around it stays put.
 */
export default function AuthTemplate({ children }: { children: React.ReactNode }) {
  return <div className="auth-enter">{children}</div>;
}
