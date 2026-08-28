import type { FacebookCheckpointSurface } from '../../shared/facebookCheckpoint'
import type { PostingCheckpointKind } from '../../shared/posting'

const checkpointSurfaceHosts: Record<FacebookCheckpointSurface, string> = {
  mbasic: 'mbasic.facebook.com',
  mobile: 'm.facebook.com',
  desktop: 'www.facebook.com'
}

export function facebookCheckpointSurfaceUrl(
  currentUrl: string,
  surface: FacebookCheckpointSurface
): string | null {
  try {
    const url = new URL(currentUrl)
    if (!url.hostname.endsWith('facebook.com') || !url.pathname.toLowerCase().includes('/checkpoint/')) {
      return null
    }
    url.protocol = 'https:'
    url.hostname = checkpointSurfaceHosts[surface]
    url.port = ''
    return url.toString()
  } catch {
    return null
  }
}

export function facebookCheckpoint282State(
  kind: PostingCheckpointKind | null
): 'waiting_manual' | 'different_checkpoint' | 'needs_login' {
  if (kind === '282') return 'waiting_manual'
  if (kind) return 'different_checkpoint'
  return 'needs_login'
}
