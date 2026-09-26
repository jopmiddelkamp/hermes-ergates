/**
 * The Section page (docs/10 "Home sections and pinned members"): renames a
 * section, or deletes it after a confirmation; its agents move to the end of
 * No section and pins stay. Opened by a long-press on a section header on
 * Home, in and out of Edit mode, or by the header's Edit section action.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useRef, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import { canSaveSectionName, deleteSectionPrompt } from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { useDeviceStore } from '@/state/device-store'
import type { Section } from '@/state/organization'
import { useTheme } from '@/theme/provider'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Page } from '@/ui/Page'

export default function SectionScreen() {
  const router = useRouter()
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const connection = usePrimaryConnection()
  const section = useDeviceStore(s => (connection ? s.organization[connection.id]?.sections.find(x => x.id === id) : undefined))
  // The section as the page opened it: after Delete it leaves the store while the page slides away.
  const [opened] = useState(section)
  const onDone = () => router.back()
  if (!connection) {
    return null
  }
  if (!opened) {
    return (
      <Page title="Section" onBack={onDone}>
        <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>This section no longer exists.</Text>
      </Page>
    )
  }
  return <SectionEditor connectionId={connection.id} section={opened} onDone={onDone} />
}

function SectionEditor({ connectionId, section, onDone }: { connectionId: string; section: Section; onDone: () => void }) {
  const renameSection = useDeviceStore(s => s.renameSection)
  const deleteSection = useDeviceStore(s => s.deleteSection)
  const [name, setName] = useState(section.name)
  // A ref, not state: a second tap landing before the pop transition unmounts
  // this screen would still read stale state and run again, renaming or
  // deleting twice (as in move-to-section.tsx).
  const done = useRef(false)

  const runOnce = (fn: () => void) => {
    if (done.current) {
      return
    }
    done.current = true
    fn()
  }

  const save = () =>
    runOnce(() => {
      renameSection(connectionId, section.id, name.trim())
      onDone()
    })

  const confirmDelete = () => {
    const prompt = deleteSectionPrompt(section.name)
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: prompt.confirm,
        style: 'destructive',
        onPress: () =>
          runOnce(() => {
            deleteSection(connectionId, section.id)
            onDone()
          })
      }
    ])
  }

  return (
    <Page title="Section" onBack={() => runOnce(onDone)}>
      <View>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Prive" />
        <Button label="Save" onPress={save} disabled={!canSaveSectionName(name, section.name)} />
      </View>
      <Button label="Delete section" variant="destructive" onPress={confirmDelete} />
    </Page>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, lineHeight: 22 }
})
