export interface User {
  displayName: string;
}

export function formatUser(user: User): string {
  return user.name;
}
