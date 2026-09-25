import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { createAgent, slugFromTitle, validateCreate } from '@/features/agents/create'
import { rosterKey, useModelOptions } from '@/features/agents/roster'
import { usePrimaryConnection } from '@/features/settings/connections'
import { useGateway } from '@/gateway/registry'
import { useTheme } from '@/theme/provider'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Sheet } from '@/ui/Sheet'

export default function NewAgentScreen() {
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection) {
    return null
  }
  return <NewAgent connection={connection} onClose={() => router.back()} />
}

function NewAgent({ connection, onClose }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; onClose: () => void }) {
  const theme = useTheme()
  const router = useRouter()
  const client = useQueryClient()
  const gateway = useGateway(connection)
  const options = useModelOptions(gateway, connection.id, 'default')
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [soul, setSoul] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)

  const effectiveName = nameTouched ? name : slugFromTitle(title)
  const errors = validateCreate({ name: effectiveName, title, provider, model })
  const providers = (options.data?.providers ?? []).filter(p => p.authenticated)

  const submit = async () => {
    setBusy(true)
    const result = await createAgent(gateway, { name: effectiveName, title, role, description, soul, provider: provider || undefined, model: model || undefined })
    setBusy(false)
    await client.invalidateQueries({ queryKey: rosterKey(connection.id) })
    if (result.error) {
      Alert.alert('Setup incomplete', `${result.error}\nSteps: ${Object.entries(result.steps).map(([k, v]) => `${k} ${v}`).join(', ')}. ${result.steps.create === 'done' ? 'The profile exists; open it from Home and finish setup in Edit Bot.' : ''}`)
      return
    }
    router.replace({ pathname: '/chat/[profile]', params: { profile: result.profile } })
  }

  return (
    <Sheet title="New Agent" onClose={onClose}>
      <Field label="Display name" value={title} onChangeText={setTitle} placeholder="Thijs" error={title && errors.title ? errors.title : undefined} />
      <Field label="Profile id" value={effectiveName} onChangeText={t => { setNameTouched(true); setName(t) }} placeholder="thijs" error={effectiveName && errors.name ? errors.name : undefined} />
      <Field label="Role (badge, optional)" value={role} onChangeText={setRole} placeholder="Bookkeeper" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Reads invoices and prepares reconciliation notes." multiline />
      <Field label="Instructions (optional)" value={soul} onChangeText={setSoul} placeholder="Leave empty to use the Hermes default." multiline />
      <Text style={[styles.label, { color: theme.colors.mutedForeground }]}>Provider and model (optional; empty inherits the server default)</Text>
      <View style={styles.chips}>
        <Pressable onPress={() => { setProvider(''); setModel('') }} accessibilityRole="button" accessibilityState={{ selected: !provider }} accessibilityLabel="Inherit provider" style={[styles.chip, { borderColor: !provider ? theme.colors.primary : theme.colors.border, backgroundColor: !provider ? theme.colors.accent : theme.colors.background }]}>
          <Text style={{ color: theme.colors.foreground }}>Inherit</Text>
        </Pressable>
        {providers.map(p => (
          <Pressable key={p.slug} onPress={() => { setProvider(p.slug); setModel(p.models[0] ?? '') }} accessibilityRole="button" accessibilityState={{ selected: provider === p.slug }} accessibilityLabel={`Provider ${p.name}`} style={[styles.chip, { borderColor: provider === p.slug ? theme.colors.primary : theme.colors.border, backgroundColor: provider === p.slug ? theme.colors.accent : theme.colors.background }]}>
            <Text style={{ color: theme.colors.foreground }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
      {provider ? (
        <View style={styles.chips}>
          {(providers.find(p => p.slug === provider)?.models ?? []).map(m => (
            <Pressable key={m} onPress={() => setModel(m)} accessibilityRole="button" accessibilityState={{ selected: model === m }} accessibilityLabel={`Model ${m}`} style={[styles.chip, { borderColor: model === m ? theme.colors.primary : theme.colors.border, backgroundColor: model === m ? theme.colors.accent : theme.colors.background }]}>
              <Text style={{ color: theme.colors.foreground }}>{m}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {provider ? <Field label="Custom model id" value={model} onChangeText={setModel} error={errors.model} /> : null}
      <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>The new agent starts without copied credentials and with the default tool policy. Narrow its tools in Edit Bot › Capabilities before giving it work.</Text>
      <View style={styles.actions}>
        <Button label={busy ? 'Creating…' : 'Create agent'} onPress={() => void submit()} loading={busy} disabled={busy || Object.keys(errors).length > 0} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, justifyContent: 'center' },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 12 },
  actions: { marginTop: 16, marginBottom: 40 }
})
