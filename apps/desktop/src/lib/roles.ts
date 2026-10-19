/** A member's role as the interface says it: sentence case, one word. */
export function roleLabel(role: string | null | undefined, isPlatformAdmin = false): string {
  if (isPlatformAdmin) return "Platform admin";
  switch (role) {
    case "admin":
      return "Admin";
    case "coach":
      return "Coach";
    case "player":
      return "Player";
    default:
      return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member";
  }
}
