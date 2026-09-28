/**
 * Avatar for a message-agent peer. Resolves the image the way `src/ui/BotRow.tsx` does: find the
 * connection, get its gateway, query the avatar asset for the peer's roster
 * profile. Either "cannot resolve" case — no local `avatarProfile` (a remote
 * peer), or an `avatarProfile` with no matching connection record — shows the
 * same "?" on the muted disc, so both look identical.
 */

import { useDeviceStore, type Connection } from '@/state/device-store'
import { useGateway } from '@/gateway/registry'
import { useAvatar } from '@/features/agents'
import { useTheme } from '@/theme/provider'
import { Avatar } from '@/ui/Avatar'
import type { PeerRef } from '@/features/chat'

export interface PeerAvatarProps {
  peer: PeerRef
  size: number
  connectionId: string
}

export function PeerAvatar({ peer, size, connectionId }: PeerAvatarProps) {
  const theme = useTheme()
  const connection = useDeviceStore(s => s.connections.find(c => c.id === connectionId))
  const avatarProfile = peer.display.avatarProfile

  if (!avatarProfile) {
    return <Avatar name="?" color={theme.colors.muted} size={size} />
  }

  if (!connection) {
    // Hooks must not be called conditionally: without a connection we cannot
    // build a gateway, so skip straight to the fallback instead of mounting
    // the inner component that calls useGateway/useAvatar. Same "?"-on-muted
    // disc as an unresolved remote peer — both are "cannot resolve" cases and
    // should look identical rather than one showing real initials.
    return <Avatar name="?" color={theme.colors.muted} size={size} />
  }

  return <ResolvedPeerAvatar peer={peer} size={size} connectionId={connectionId} connection={connection} avatarProfile={avatarProfile} />
}

function ResolvedPeerAvatar({
  peer,
  size,
  connectionId,
  connection,
  avatarProfile
}: {
  peer: PeerRef
  size: number
  connectionId: string
  connection: Connection
  avatarProfile: string
}) {
  const gateway = useGateway(connection)
  const { data } = useAvatar(gateway, connectionId, avatarProfile, true)
  return <Avatar name={peer.display.name} color={peer.display.color} imageUri={data ?? null} size={size} />
}
