/**
 * Edit Bot basic form (docs/10 "Edit Bot on mobile"): name, role, description
 * and avatar inline; instructions, provider/model and capabilities are
 * focused subpages that share this same draft through `EditBotProvider`.
 * Save is not atomic — each section's outcome is reported separately.
 */

import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { botsMeta, type SaveOutcome, type SaveSection } from '@/features/agents/editor'
import { useEditBotContext } from '@/features/agents/editor-context'
import { pickAvatar } from '@/features/files/attach'
import { userMessage } from '@/gateway/errors'
import { useTheme } from '@/theme/provider'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Icon } from '@/ui/icons'
import { Sheet } from '@/ui/Sheet'

const SECTION_LABELS: Record<SaveSection, string> = {
  metadata: 'Name & role',
  text: 'Description & instructions',
  model: 'Provider & model',
  capabilities: 'Skills, tools & connectors',
  avatar: 'Photo'
}

function describeOutcome(outcome: SaveOutcome, section: SaveSection): string {
  const value = outcome.sections[section]
  const error = outcome.errors[section]
  switch (value) {
    case 'saved':
      return 'saved'
    case 'failed':
      return error ? `failed (${error})` : 'failed'
    case 'conflict':
      return error ? `conflict (${error})` : 'conflict'
    case 'confirm_required':
      return 'needs confirmation'
    default:
      return value
  }
}

export default function EditBotScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const controller = useEditBotContext()

  return <EditBotForm profile={profile} onClose={() => router.back()} controller={controller} />
}

function EditBotForm({
  profile,
  onClose,
  controller
}: {
  profile: string
  onClose: () => void
  controller: ReturnType<typeof useEditBotContext>
}) {
  const theme = useTheme()
  const router = useRouter()
  const navigation = useNavigation()
  const { phase, draft, errors, dirty, loadError, outcome, update, reload, save, confirmModel, discard } = controller

  // `confirmModel`'s identity changes across the several state updates a save
  // triggers (setOutcome/setDraft/setPhase inside `finish()`), so this reads
  // it through a ref and depends on `outcome` alone; `alertedOutcomeRef`
  // additionally guards against firing twice for the same outcome object
  // (e.g. React StrictMode's double effect invocation in development).
  const confirmModelRef = useRef(confirmModel)
  confirmModelRef.current = confirmModel
  const alertedOutcomeRef = useRef<SaveOutcome | null>(null)

  useEffect(() => {
    if (!outcome || alertedOutcomeRef.current === outcome) {
      return
    }
    if ((Object.values(outcome.sections) as string[]).includes('confirm_required')) {
      alertedOutcomeRef.current = outcome
      Alert.alert(
        'Confirm model change',
        outcome.confirmMessage ?? 'This model may need extra confirmation. Use it anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Use this model', onPress: () => void confirmModelRef.current() }
        ]
      )
    }
  }, [outcome])

  const confirmKeepEditing = (onDiscard: () => void) => {
    Alert.alert('Keep editing?', 'Your changes have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard }
    ])
  }

  // The route is a modal Stack screen: iOS swipe-to-dismiss and the Android
  // back gesture remove it directly, bypassing the Cancel/close handlers
  // below. `beforeRemove` fires for every removal path (including those),
  // so guard it here too. `usePreventRemove` would be the direct way to do
  // this, but this expo-router version does not re-export it publicly.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const discardRef = useRef(discard)
  discardRef.current = discard

  const closeDirty = () => {
    if (!dirty) {
      onClose()
      return
    }
    confirmKeepEditing(() => {
      // `discard()` resets the draft through React state, so `dirtyRef` would
      // still read true when `router.back()` fires `beforeRemove` below;
      // clear it synchronously so the guard does not ask a second time.
      dirtyRef.current = false
      discard()
      onClose()
    })
  }

  useEffect(() => {
    return navigation.addListener('beforeRemove', e => {
      if (!dirtyRef.current) {
        return
      }
      e.preventDefault()
      confirmKeepEditing(() => {
        discardRef.current()
        navigation.dispatch(e.data.action)
      })
    })
  }, [navigation])

  if (phase === 'loading' && !draft) {
    return (
      <Sheet title="Edit Bot" onClose={onClose}>
        <ActivityIndicator style={styles.loading} color={theme.colors.foreground} />
      </Sheet>
    )
  }

  if (phase === 'error' || !draft) {
    return (
      <Sheet title="Edit Bot" onClose={onClose}>
        <Text style={[styles.errorText, { color: theme.colors.destructive }]}>{loadError ?? 'This bot could not be loaded.'}</Text>
        <Button label="Try again" onPress={() => void reload()} />
      </Sheet>
    )
  }

  const canSave = dirty && Object.keys(errors).length === 0 && phase !== 'saving'
  const previewUri = draft.avatar.kind === 'set' ? draft.avatar.dataUrl : draft.avatar.kind === 'clear' ? null : draft.base.avatarDataUrl
  const hasAvatar = draft.avatar.kind === 'set' || (draft.avatar.kind === 'keep' && Boolean(draft.base.avatarDataUrl))
  const avatarColor = botsMeta(draft.base.summary).color

  const onChoosePhoto = async () => {
    try {
      // `pickAvatar` crops square and compresses under the 2,000,000-byte asset
      // cap; the chat attachment picker sends photos at full resolution (I9).
      const picked = await pickAvatar()
      if (picked) {
        update({ avatar: { kind: 'set', dataUrl: picked.dataUrl } })
      }
    } catch (err) {
      Alert.alert('Could not open photos', userMessage(err))
    }
  }

  const sections = outcome?.sections
  const shownSections = sections ? (Object.keys(sections) as SaveSection[]).filter(s => sections[s] !== 'skipped') : []

  return (
    <Sheet
      title="Edit Bot"
      onClose={closeDirty}
      headerLeft={<Button label="Cancel" variant="ghost" compact onPress={closeDirty} accessibilityLabel="Cancel" />}
      headerRight={<Button label="Save" onPress={() => void save()} loading={phase === 'saving'} disabled={!canSave} accessibilityLabel="Save" />}
    >

      <View style={styles.avatarRow}>
        <Avatar name={draft.name || profile} color={avatarColor} imageUri={previewUri} size={84} />
        <View style={styles.avatarButtons}>
          <Button label="Choose photo" variant="secondary" onPress={() => void onChoosePhoto()} accessibilityLabel="Choose photo" />
          {hasAvatar ? (
            <Button label="Remove photo" variant="ghost" onPress={() => update({ avatar: { kind: 'clear' } })} accessibilityLabel="Remove photo" />
          ) : null}
        </View>
      </View>
      {errors.avatar ? <Text style={[styles.fieldError, { color: theme.colors.destructive }]}>{errors.avatar}</Text> : null}

      <Field label="Name" value={draft.name} onChangeText={name => update({ name })} placeholder="Kevin" error={errors.name} accessibilityLabel="Name" />
      <Field label="Role (badge, optional)" value={draft.role} onChangeText={role => update({ role })} placeholder="Trainer" accessibilityLabel="Role" />
      <Field label="Description" value={draft.description} onChangeText={description => update({ description })} placeholder="Short purpose statement." multiline accessibilityLabel="Description" />

      <View style={[styles.rows, { borderColor: theme.colors.border }]}>
        <NavRow label="Instructions" onPress={() => router.push({ pathname: '/agent/[profile]/edit-instructions', params: { profile } })} />
        <NavRow
          label="Provider / Model"
          value={draft.provider && draft.model ? `${draft.provider} · ${draft.model}` : 'Inherit from server default'}
          error={errors.model}
          onPress={() => router.push({ pathname: '/agent/[profile]/edit-model', params: { profile } })}
        />
        <NavRow label="Capabilities" error={errors.toolsets} onPress={() => router.push({ pathname: '/agent/[profile]/edit-capabilities', params: { profile } })} />
      </View>

      {outcome && shownSections.length > 0 ? (
        <View style={styles.outcome}>
          {shownSections.map(section => (
            <Text
              key={section}
              style={[styles.outcomeLine, { color: outcome.sections[section] === 'saved' ? theme.colors.mutedForeground : theme.colors.destructive }]}
            >
              {SECTION_LABELS[section]}: {describeOutcome(outcome, section)}
            </Text>
          ))}
        </View>
      ) : null}
    </Sheet>
  )
}

function NavRow({ label, value, error, onPress }: { label: string; value?: string; error?: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.navRow, { backgroundColor: pressed ? theme.colors.accent : 'transparent' }]}
    >
      <View style={styles.navRowText}>
        <Text style={[styles.navRowLabel, { color: theme.colors.foreground }]}>{label}</Text>
        {value ? (
          <Text numberOfLines={1} style={[styles.navRowValue, { color: theme.colors.mutedForeground }]}>
            {value}
          </Text>
        ) : null}
        {error ? <Text style={[styles.fieldError, { color: theme.colors.destructive }]}>{error}</Text> : null}
      </View>
      <Icon name="chevron-right" size={20} color={theme.colors.mutedForeground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  loading: { marginVertical: 40 },
  errorText: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, marginBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  avatarButtons: { gap: 8, alignItems: 'flex-start' },
  fieldError: { fontSize: 13, marginTop: 2 },
  rows: { marginTop: 8, marginBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
  navRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  navRowText: { flex: 1, gap: 2 },
  navRowLabel: { fontSize: 17 },
  navRowValue: { fontSize: 14 },
  outcome: { gap: 4, marginBottom: 24 },
  outcomeLine: { fontSize: 13, lineHeight: 18 }
})
