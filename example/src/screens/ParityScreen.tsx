import React, { useRef, useState } from 'react'
import { Keyboard, ScrollView, Text, TextInput, View } from 'react-native'
import { MorphInput, type MorphInputHandle } from 'react-native-nitro-input'
import { Btn, Card, EventLog, FieldLabel, Row, styles, useEventLog } from '../harness'

/**
 * Side-by-side probe of every callback and imperative method both components
 * expose, so their ordering and payloads can be compared on one screen.
 */
export function ParityScreen() {
  const { lines, push, clear } = useEventLog()
  const morph = useRef<MorphInputHandle>(null)
  const rn = useRef<React.ComponentRef<typeof TextInput>>(null)
  const [editable, setEditable] = useState(true)
  const [secure, setSecure] = useState(false)
  const [keepFocus, setKeepFocus] = useState(false)
  const [morphText, setMorphText] = useState('')
  const [rnText, setRnText] = useState('')

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title="Imperative API">
        <Row>
          <Btn testID="parity-morph-focus" title="morph.focus" onPress={() => morph.current?.focus()} />
          <Btn testID="parity-morph-blur" title="morph.blur" onPress={() => morph.current?.blur()} />
          <Btn testID="parity-morph-clear" title="morph.clear" onPress={() => morph.current?.clear()} />
          <Btn testID="parity-morph-isfocused" title="morph.isFocused" onPress={() => push('screen', `morph.isFocused() = ${morph.current?.isFocused()}`)} />
        </Row>
        <Row>
          <Btn testID="parity-rn-focus" title="rn.focus" onPress={() => rn.current?.focus()} />
          <Btn testID="parity-rn-blur" title="rn.blur" onPress={() => rn.current?.blur()} />
          <Btn testID="parity-rn-clear" title="rn.clear" onPress={() => rn.current?.clear()} />
          <Btn testID="parity-rn-isfocused" title="rn.isFocused" onPress={() => push('screen', `rn.isFocused() = ${rn.current?.isFocused()}`)} />
        </Row>
      </Card>
      <Card title="Global keyboard state" hint="TextInput.State is what Keyboard.dismiss(), keyboardShouldPersistTaps and ScrollView auto-blur consult.">
        <Row>
          <Btn testID="parity-dismiss" title="Keyboard.dismiss()" onPress={() => { push('screen', 'Keyboard.dismiss()'); Keyboard.dismiss() }} />
          <Btn
            testID="parity-currently-focused"
            title="currentlyFocusedInput()"
            onPress={() => push('screen', `currentlyFocusedInput() = ${String(TextInput.State.currentlyFocusedInput() ?? null)}`)}
          />
          <Btn testID="parity-blur-all" title="State.blurTextInput" onPress={() => {
            const f = TextInput.State.currentlyFocusedInput()
            push('screen', `blurTextInput(${String(f ?? null)})`)
            if (f) TextInput.State.blurTextInput(f)
          }} />
        </Row>
        <Row>
          <Btn testID="parity-editable" title={`editable: ${editable}`} onPress={() => setEditable(e => !e)} />
          <Btn testID="parity-secure" title={`secure: ${secure}`} onPress={() => setSecure(v => !v)} />
          <Btn testID="parity-submit-behavior" title={`submit: ${keepFocus ? 'submit' : 'blurAndSubmit'}`} onPress={() => setKeepFocus(v => !v)} />
          <Btn testID="parity-clear-log" title="clear log" onPress={clear} />
        </Row>
      </Card>
      <Card title="Event log">
        <EventLog lines={lines} testID="parity-log" />
        <Text testID="parity-values" style={styles.cardHint}>{`morph="${morphText}"  rn="${rnText}"`}</Text>
      </Card>
      <Card title="Same props, both components" hint="Type in each and watch the log: callback names, order and payloads should line up.">
        <FieldLabel>MorphInput</FieldLabel>
        <MorphInput
          testID="parity-morph"
          accessibilityLabel="morph field"
          ref={morph}
          style={styles.field}
          fontSize={22}
          placeholder="morph"
          editable={editable}
          maxLength={20}
          returnKeyType="done"
          secureTextEntry={secure}
          submitBehavior={keepFocus ? 'submit' : 'blurAndSubmit'}
          value={morphText}
          onChangeText={t => {
            setMorphText(t)
            push('morph', `onChangeText "${t}"`)
          }}
          onFocus={() => push('morph', 'onFocus')}
          onBlur={() => push('morph', 'onBlur')}
          onSubmitEditing={t => push('morph', `onSubmitEditing "${t}"`)}
          onEndEditing={t => push('morph', `onEndEditing "${t}"`)}
          onSelectionChange={sel => push('morph', `onSelectionChange ${sel.start}-${sel.end}`)}
          onKeyPress={k => push('morph', `onKeyPress "${k}"`)}
        />
        <FieldLabel>TextInput</FieldLabel>
        <TextInput
          testID="parity-rn"
          ref={rn}
          style={[styles.field, styles.rnField]}
          placeholder="rn"
          editable={editable}
          maxLength={20}
          returnKeyType="done"
          secureTextEntry={secure}
          submitBehavior={keepFocus ? 'submit' : 'blurAndSubmit'}
          value={rnText}
          onChangeText={t => {
            setRnText(t)
            push('rn', `onChangeText "${t}"`)
          }}
          onFocus={() => push('rn', 'onFocus')}
          onBlur={() => push('rn', 'onBlur')}
          onSubmitEditing={e => push('rn', `onSubmitEditing "${e.nativeEvent.text}"`)}
          onEndEditing={e => push('rn', `onEndEditing "${e.nativeEvent.text}"`)}
          onSelectionChange={e => push('rn', `onSelectionChange ${e.nativeEvent.selection.start}-${e.nativeEvent.selection.end}`)}
          onKeyPress={e => push('rn', `onKeyPress "${e.nativeEvent.key}"`)}
        />
      </Card>



    </ScrollView>
  )
}
