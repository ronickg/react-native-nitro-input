import React, { useCallback, useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { MorphInput, type MorphInputHandle } from 'react-native-nitro-input'
import { Btn, Card, EventLog, FieldLabel, Row, styles, useEventLog } from '../harness'
import type { RootStackParamList } from '../navigation'

type Kind = 'morph' | 'rn'

/** First screen of the two-screen focus test. */
export function NavAScreen() {
  const nav = useNavigation<any>()
  const { lines, push, clear } = useEventLog()
  const morph = useRef<MorphInputHandle>(null)
  const rn = useRef<React.ComponentRef<typeof TextInput>>(null)

  useFocusEffect(useCallback(() => {
    push('screen', 'A: focus')
    return () => push('screen', 'A: blur')
  }, [push]))

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title="Screen A" hint="Focus a field here, then push B. Coming back, check whether the keyboard and caret behave the same for both.">
        <FieldLabel>MorphInput</FieldLabel>
        <MorphInput
          testID="navA-morph"
          ref={morph}
          style={styles.field}
          fontSize={22}
          placeholder="A / morph"
          onFocus={() => push('morph', 'A onFocus')}
          onBlur={() => push('morph', 'A onBlur')}
        />
        <FieldLabel>TextInput</FieldLabel>
        <TextInput
          testID="navA-rn"
          ref={rn}
          style={[styles.field, styles.rnField]}
          placeholder="A / rn"
          onFocus={() => push('rn', 'A onFocus')}
          onBlur={() => push('rn', 'A onBlur')}
        />
      </Card>

      <Card title="Push screen B" hint="B autofocuses the chosen component on mount.">
        <Row>
          <Btn testID="navA-push-morph" tone="primary" title="Push B (morph autoFocus)" onPress={() => nav.navigate('NavB', { kind: 'morph' })} />
          <Btn testID="navA-push-rn" tone="primary" title="Push B (rn autoFocus)" onPress={() => nav.navigate('NavB', { kind: 'rn' })} />
        </Row>
        <Row>
          <Btn testID="navA-focus-then-push-morph" title="Focus A, then push B" onPress={() => { morph.current?.focus(); setTimeout(() => nav.navigate('NavB', { kind: 'morph' }), 400) }} />
          <Btn testID="navA-clear-log" title="clear log" onPress={clear} />
        </Row>
      </Card>

      <Card title="Event log"><EventLog lines={lines} testID="navA-log" /></Card>
    </ScrollView>
  )
}

/** Second screen: autofocuses whichever component the route asked for. */
export function NavBScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'NavB'>>()
  const nav = useNavigation<any>()
  const kind: Kind = route.params?.kind ?? 'morph'
  const { lines, push } = useEventLog()

  useFocusEffect(useCallback(() => {
    push('screen', `B: focus (autoFocus ${kind})`)
    return () => push('screen', 'B: blur')
  }, [push, kind]))

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title={`Screen B — autoFocus on ${kind}`} hint="The keyboard should already be up when the push transition ends.">
        {kind === 'morph' ? (
          <MorphInput
            testID="navB-morph"
            autoFocus
            style={styles.field}
            fontSize={22}
            placeholder="B / morph"
            onFocus={() => push('morph', 'B onFocus')}
            onBlur={() => push('morph', 'B onBlur')}
          />
        ) : (
          <TextInput
            testID="navB-rn"
            autoFocus
            style={[styles.field, styles.rnField]}
            placeholder="B / rn"
            onFocus={() => push('rn', 'B onFocus')}
            onBlur={() => push('rn', 'B onBlur')}
          />
        )}
        <Row>
          <Btn testID="navB-back" title="Back to A" onPress={() => nav.goBack()} />
        </Row>
      </Card>
      <Card title="Event log"><EventLog lines={lines} testID="navB-log" /></Card>
    </ScrollView>
  )
}

/** Presented with `presentation: 'formSheet'`. */
export function FormSheetScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Sheet'>>()
  const nav = useNavigation<any>()
  const kind: Kind = route.params?.kind ?? 'morph'
  const auto = route.params?.autoFocus ?? true
  const { lines, push } = useEventLog()
  const morph = useRef<MorphInputHandle>(null)
  const rn = useRef<React.ComponentRef<typeof TextInput>>(null)

  return (
    <View style={[styles.screen, { padding: 16, gap: 12 }]}>
      <Text style={styles.cardTitle}>{`Form sheet — ${kind}${auto ? ' (autoFocus)' : ''}`}</Text>
      <Text style={styles.cardHint}>
        The sheet must resize or lift for the keyboard, and the caret must stay visible. Both components get the same treatment.
      </Text>
      {kind === 'morph' ? (
        <MorphInput
          testID="sheet-morph"
          ref={morph}
          autoFocus={auto}
          style={styles.field}
          fontSize={22}
          placeholder="sheet / morph"
          onFocus={() => push('morph', 'sheet onFocus')}
          onBlur={() => push('morph', 'sheet onBlur')}
        />
      ) : (
        <TextInput
          testID="sheet-rn"
          ref={rn}
          autoFocus={auto}
          style={[styles.field, styles.rnField]}
          placeholder="sheet / rn"
          onFocus={() => push('rn', 'sheet onFocus')}
          onBlur={() => push('rn', 'sheet onBlur')}
        />
      )}
      <Row>
        <Btn testID="sheet-focus" title="focus" onPress={() => (kind === 'morph' ? morph.current?.focus() : rn.current?.focus())} />
        <Btn testID="sheet-blur" title="blur" onPress={() => (kind === 'morph' ? morph.current?.blur() : rn.current?.blur())} />
        <Btn testID="sheet-close" title="close" onPress={() => nav.goBack()} />
      </Row>
      <EventLog lines={lines} testID="sheet-log" />
    </View>
  )
}
