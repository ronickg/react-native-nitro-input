import React, { useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { MorphInput, type MorphInputHandle } from 'react-native-nitro-input'
import { Btn, Card, EventLog, FieldLabel, Row, styles, useEventLog } from '../harness'

/**
 * Focus survival across the re-renders a real screen does while a field is
 * focused: a sibling appearing, the parent re-rendering, a `key` change that
 * remounts the field, and focusing a field that a state change just revealed.
 */
export function StateChangeScreen() {
  const { lines, push, clear } = useEventLog()
  const morph = useRef<MorphInputHandle>(null)
  const rn = useRef<React.ComponentRef<typeof TextInput>>(null)
  const revealMorph = useRef<MorphInputHandle>(null)
  const revealRn = useRef<React.ComponentRef<typeof TextInput>>(null)

  const [banner, setBanner] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [remountKey, setRemountKey] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [swapped, setSwapped] = useState(false)

  const fields = (
    <>
      <FieldLabel>MorphInput</FieldLabel>
      <MorphInput
        key={`morph-${remountKey}`}
        testID="state-morph"
        ref={morph}
        style={styles.field}
        fontSize={22}
        placeholder={`morph ${nonce}`}
        onFocus={() => push('morph', 'onFocus')}
        onBlur={() => push('morph', 'onBlur')}
      />
      <FieldLabel>TextInput</FieldLabel>
      <TextInput
        key={`rn-${remountKey}`}
        testID="state-rn"
        ref={rn}
        style={[styles.field, styles.rnField]}
        placeholder={`rn ${nonce}`}
        onFocus={() => push('rn', 'onFocus')}
        onBlur={() => push('rn', 'onBlur')}
      />
    </>
  )

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title="Focus vs. re-render" hint="Focus a field, then press each button. Focus should survive everything except the remount.">
        {banner ? (
          <View testID="state-banner" style={{ padding: 10, borderRadius: 8, backgroundColor: '#FEF3C7' }}>
            <Text style={styles.cardHint}>A sibling appeared above the fields.</Text>
          </View>
        ) : null}
        {swapped ? <View style={{ height: 40 }} /> : null}
        {fields}
      </Card>

      <Card title="Trigger a state change while focused">
        <Row>
          <Btn testID="state-banner-toggle" title="toggle sibling" onPress={() => { push('screen', 'toggle sibling'); setBanner(b => !b) }} />
          <Btn testID="state-rerender" title="re-render (new prop)" onPress={() => { push('screen', 'new placeholder'); setNonce(n => n + 1) }} />
          <Btn testID="state-shift" title="shift layout" onPress={() => { push('screen', 'shift layout'); setSwapped(s => !s) }} />
          <Btn testID="state-remount" title="remount (key++)" onPress={() => { push('screen', 'remount'); setRemountKey(k => k + 1) }} />
        </Row>
      </Card>

      <Card title="Focus a field a state change just revealed" hint="The classic case: render the field and call focus() in the same tick.">
        <Row>
          <Btn
            testID="state-reveal-morph"
            tone="primary"
            title="reveal + focus morph"
            onPress={() => { push('screen', 'reveal + focus morph'); setRevealed(true); requestAnimationFrame(() => revealMorph.current?.focus()) }}
          />
          <Btn
            testID="state-reveal-rn"
            tone="primary"
            title="reveal + focus rn"
            onPress={() => { push('screen', 'reveal + focus rn'); setRevealed(true); requestAnimationFrame(() => revealRn.current?.focus()) }}
          />
          <Btn testID="state-reveal-hide" title="hide" onPress={() => setRevealed(false)} />
        </Row>
        {revealed ? (
          <View style={{ gap: 8 }} testID="state-revealed">
            <MorphInput
              testID="state-reveal-morph-field"
              ref={revealMorph}
              style={styles.field}
              fontSize={22}
              placeholder="revealed morph"
              onFocus={() => push('morph', 'revealed onFocus')}
              onBlur={() => push('morph', 'revealed onBlur')}
            />
            <TextInput
              testID="state-reveal-rn-field"
              ref={revealRn}
              style={[styles.field, styles.rnField]}
              placeholder="revealed rn"
              onFocus={() => push('rn', 'revealed onFocus')}
              onBlur={() => push('rn', 'revealed onBlur')}
            />
          </View>
        ) : null}
      </Card>

      <Card title="Event log">
        <EventLog lines={lines} testID="state-log" />
        <Row><Btn testID="state-clear-log" title="clear log" onPress={clear} /></Row>
      </Card>
    </ScrollView>
  )
}
