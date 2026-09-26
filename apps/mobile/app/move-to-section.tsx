/**
 * Move to Section (docs/10 "Bot actions"): moves one or more agents to No
 * section or to a section, or into a new section named here, then goes back.
 * Opened from the long-press menu and from the Home Edit mode bottom bar.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { canCreateSection, newSection, parseProfiles, sectionChoices } from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { useDeviceStore } from '@/state/device-store'
import { emptyOrganization } from '@/state/organization'
import { useTheme } from '@/theme/provider'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Group } from '@/ui/Group'
import { Icon } from '@/ui/icons'
import { ListRow } from '@/ui/ListRow'
import { Page } from '@/ui/Page'

const EMPTY_ORG = emptyOrganization()

export default function MoveToSectionScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ profiles?: string }>()
  const connection = usePrimaryConnection()
  const profiles = useMemo(() => parseProfiles(params.profiles), [params.profiles])
  if (!connection) {
    return null
  }
  return <MoveToSection connectionId={connection.id} profiles={profiles} onDone={() => router.back()} />
}

function MoveToSection({ connectionId, profiles, onDone }: { connectionId: string; profiles: string[]; onDone: () => void }) {
  const theme = useTheme()
  const organization = useDeviceStore(s => s.organization[connectionId]) ?? EMPTY_ORG
  const moveRowsToSection = useDeviceStore(s => s.moveRowsToSection)
  const createSection = useDeviceStore(s => s.createSection)
  const [name, setName] = useState('')

  const moveTo = (sectionId: string | null) => {
    moveRowsToSection(connectionId, profiles, sectionId)
    onDone()
  }

  const create = () => {
    const section = newSection(organization.sections, name)
    createSection(connectionId, section)
    moveTo(section.id)
  }

  return (
    <Page title="Move to Section" onBack={onDone}>
      <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>Sections organize Home on this phone. A pinned agent stays pinned.</Text>
      <Group>
        {sectionChoices(organization, profiles).map(choice => (
          <ListRow
            key={choice.id ?? 'none'}
            title={choice.name}
            icon={choice.id === null ? 'inbox' : 'folder'}
            selected={choice.checked}
            right={choice.checked ? <Icon name="check" size={22} color={theme.colors.primary} /> : <View style={styles.noCheck} />}
            onPress={() => moveTo(choice.id)}
          />
        ))}
      </Group>
      <View>
        <Field label="New section name" value={name} onChangeText={setName} placeholder="Prive" />
        <Button label="Create section" onPress={create} disabled={!canCreateSection(name)} />
      </View>
    </Page>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, lineHeight: 22 },
  noCheck: { width: 22 }
})
