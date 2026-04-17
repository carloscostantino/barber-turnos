const PREFIX = 'barber_admin_onboarding_done_'

export function isOnboardingDone(shopSlug: string): boolean {
  try {
    return localStorage.getItem(PREFIX + shopSlug) === '1'
  } catch {
    return false
  }
}

export function setOnboardingDone(shopSlug: string): void {
  try {
    localStorage.setItem(PREFIX + shopSlug, '1')
  } catch {
    /* ignore */
  }
}
