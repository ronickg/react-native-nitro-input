import React, { useRef, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardToolbar,
  useKeyboardHandler,
  useReanimatedFocusedInput,
} from 'react-native-keyboard-controller'
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { NitroInput, type NitroInputHandle } from 'react-native-nitro-input'
import { Btn, Card, EventLog, FieldLabel, Row, styles, useEventLog } from '../harness'

/**
 * Alternating Morph / RN fields inside a `KeyboardAwareScrollView`, with the
 * toolbar's next/prev traversal and a live readout of what
 * `useReanimatedFocusedInput` reports. If a reflowing NitroInput is invisible to
 * keyboard-controller the readout stays at target -1 and auto-scroll never
 * fires for it.
 */
export function KeyboardControllerScreen() {
  const { lines, push, clear } = useEventLog()
  const [focusedInfo, setFocusedInfo] = useState('target -1')
  const [kbInfo, setKbInfo] = useState('height 0')
  const morph = useRef<NitroInputHandle>(null)

  const { input } = useReanimatedFocusedInput()
  useAnimatedReaction(
    () => input.value,
    current => {
      const t = current?.target ?? -1
      const l = current?.layout
      runOnJS(setFocusedInfo)(
        `target ${t} · parentScroll ${current?.parentScrollViewTarget ?? -1} · y ${Math.round(l?.absoluteY ?? 0)} · h ${Math.round(l?.height ?? 0)}`,
      )
    },
    [],
  )

  const height = useSharedValue(0)
  useKeyboardHandler({
    onMove: e => {
      'worklet'
      height.value = e.height
    },
    onEnd: e => {
      'worklet'
      runOnJS(setKbInfo)(`height ${Math.round(e.height)} · duration ${e.duration}`)
    },
  }, [])

  const rows = [0, 1, 2, 3, 4, 5]

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView
        testID="kc-scroll"
        style={styles.screen}
        contentContainerStyle={styles.content}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <Card title="keyboard-controller readouts" hint="These come from the native focused-input observer. A reflowing NitroInput that it cannot see reports target -1.">
          <Text testID="kc-focused" style={styles.cardHint}>{`focused: ${focusedInfo}`}</Text>
          <Text testID="kc-keyboard" style={styles.cardHint}>{`keyboard: ${kbInfo}`}</Text>
          <Row><Btn testID="kc-clear-log" title="clear log" onPress={clear} /></Row>
        </Card>

        <Card title="Alternating fields" hint="Tap the last ones: KeyboardAwareScrollView should scroll each into view above the keyboard, whichever component it is.">
          {rows.map(i => (
            <View key={i} style={{ gap: 6 }}>
              <FieldLabel>{`morph ${i}`}</FieldLabel>
              <NitroInput transition="reflow"
                testID={`kc-morph-${i}`}
                ref={i === 0 ? morph : undefined}
                style={styles.field}
                fontSize={20}
                placeholder={`morph ${i}`}
                onFocus={() => push('morph', `${i} onFocus`)}
                onBlur={() => push('morph', `${i} onBlur`)}
              />
              <FieldLabel>{`rn ${i}`}</FieldLabel>
              <TextInput
                testID={`kc-rn-${i}`}
                style={[styles.field, styles.rnField]}
                placeholder={`rn ${i}`}
                onFocus={() => push('rn', `${i} onFocus`)}
                onBlur={() => push('rn', `${i} onBlur`)}
              />
            </View>
          ))}
        </Card>

        <Card title="Event log"><EventLog lines={lines} testID="kc-log" /></Card>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </View>
  )
}
