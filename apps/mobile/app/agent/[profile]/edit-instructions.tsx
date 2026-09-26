/**
 * Instructions: a full-screen editor for `SOUL.md` (docs/10 "Edit Bot on
 * mobile"). Pushed from Edit Bot and shares its draft through
 * `EditBotProvider`; text is kept exactly as typed.
 */

import { useRouter } from 'expo-router'
import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'

import { useEditBotContext } from '@/features/agents'
import { useTheme } from '@/theme/provider'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'
import { useBottomInset } from '@/ui/use-bottom-inset'

export default function EditInstructionsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { draft, update } = useEditBotContext()
  // No scroll view here (the editor fills the screen), so the screen's own
  // content carries the inset instead of Screen reserving a strip for it.
  const bottomInset = useBottomInset()

  return (
    // This screen never had a top inset (its header sits flush with the
    // status bar, unchanged); only the old bottom-edge reservation goes.
    <Screen edges={[]} style={{ paddingBottom: bottomInset }}>
      <View style={styles.header}>
        <IconButton name="chevron-left" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={[styles.title, { color: theme.colors.foreground }]}>Instructions</Text>
        <View style={styles.spacer} />
      </View>

      {draft ? (
        <>
          <TextInput
            multiline
            value={draft.soul}
            onChangeText={soul => update({ soul })}
            placeholder="Write the bot's SOUL.md instructions…"
            placeholderTextColor={theme.colors.mutedForeground}
            textAlignVertical="top"
            accessibilityLabel="Instructions"
            selectionColor={theme.colors.primary}
            style={[styles.editor, { color: theme.colors.foreground, backgroundColor: theme.colors.muted }]}
          />
          <Text style={[styles.note, { color: theme.colors.mutedForeground }]}>
            The Bot Chat messaging protocol is added by Hermes at run time; do not paste it here.
          </Text>
        </>
      ) : (
        <ActivityIndicator style={styles.loading} color={theme.colors.foreground} />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: 8, gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  spacer: { width: 44 },
  loading: { marginTop: 40 },
  editor: { flex: 1, marginTop: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, lineHeight: 24 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 12, marginBottom: 12 }
})
