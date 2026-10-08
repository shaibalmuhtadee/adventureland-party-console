/** One headless login default for roster display, explicit login and startup restoration. */
export function characterHomeWorld(preferred: string | undefined, gameHome: string | undefined, fallback: string): string {
  return preferred || (gameHome ? 'SR_' + gameHome.replace(/^SR_/, '') : fallback);
}
