import React from 'react'
import { I18nManager, ScrollView, TextInput } from 'react-native'
import { MorphInput, NitroInput } from 'react-native-nitro-input'
import { RollingNumber } from 'react-native-nitro-input'
import { Card, FieldLabel, styles } from '../harness'

/**
 * Everything that has an edge, under the layout direction the app is in:
 * alignment, a prefix and a suffix (plain and morphed), a floating label and
 * its notch - with React Native's own TextInput beside the first for the
 * reference. Flip the direction from Home; the app reloads.
 *
 * The cards are keyed. Without keys a reorder makes React reuse the field
 * instances by position, and `defaultValue` is initial-only - the "Start edge"
 * instance became the amount field and normalised to nothing in number mode.
 * A recycled *native* view is not the problem: `prepareForRecycle` zeroes the
 * edit count, so the next element's first text lands.
 */
export function RtlScreen() {
  const dir = I18nManager.isRTL ? 'right-to-left' : 'left-to-right'
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card key="affixes" title="Affixes" hint="A prefix belongs at the start edge and a suffix at the end edge, so both mirror with the direction.">
        <FieldLabel>PLAIN, PREFIX + SUFFIX</FieldLabel>
        <NitroInput testID="rtl-plain-amount" mode="number" prefix="$" suffix=" USD" defaultValue="1234.56" style={styles.field} />
        <FieldLabel>PLAIN, THIS FIELD THE OTHER WAY (STYLE.DIRECTION)</FieldLabel>
        <NitroInput
          testID="rtl-plain-flipped"
          mode="number"
          prefix="$"
          suffix=" USD"
          defaultValue="1234.56"
          style={[styles.field, { direction: I18nManager.isRTL ? 'ltr' : 'rtl' }]}
        />
        <FieldLabel>MORPH, PREFIX + SUFFIX</FieldLabel>
        <MorphInput testID="rtl-morph-amount" mode="number" prefix="$" suffix=" USD" defaultValue="1234.56" fontSize={22} style={{ width: '100%' }} />
        <FieldLabel>MORPH, NEGATIVE</FieldLabel>
        <MorphInput testID="rtl-morph-negative" mode="number" prefix="$" defaultValue="-1234.56" fontSize={22} style={{ width: '100%' }} />
        <FieldLabel>ROLLING NUMBER, PREFIX + SUFFIX</FieldLabel>
        <RollingNumber testID="rtl-rolling" value={1234.56} fractionDigits={2} prefix="$" suffix=" USD" fontSize={22} style={{ width: '100%' }} />
        <FieldLabel>ROLLING NUMBER, NEGATIVE</FieldLabel>
        <RollingNumber testID="rtl-rolling-negative" value={-1234.56} fractionDigits={2} prefix="$" fontSize={22} style={{ width: '100%' }} />
      </Card>
      <Card key="frame" title="Frame" hint="The label and the notch sit at the start edge.">
        <NitroInput
          testID="rtl-frame"
          variant="outlined"
          label="Email address"
          placeholder="you@example.com"
          keyboardType="email-address"
          style={{ width: '100%', height: 52 }}
        />
      </Card>
      <Card key="alignment" title={`Layout direction: ${dir}`} hint="textAlign defaults to 'auto', the start edge - what TextInput does. 'left' and 'right' are absolute.">
        <FieldLabel>NITROINPUT, AUTO</FieldLabel>
        <NitroInput testID="rtl-auto" defaultValue="Start edge" style={styles.field} />
        <FieldLabel>TEXTINPUT, DEFAULT</FieldLabel>
        <TextInput testID="rtl-rn-auto" defaultValue="Start edge" style={[styles.field, styles.rnField]} />
        <FieldLabel>NITROINPUT, LEFT</FieldLabel>
        <NitroInput testID="rtl-left" textAlign="left" defaultValue="Left" style={styles.field} />
        <FieldLabel>NITROINPUT, RIGHT</FieldLabel>
        <NitroInput testID="rtl-right" textAlign="right" defaultValue="Right" style={styles.field} />
        <FieldLabel>NITROINPUT, CENTER</FieldLabel>
        <NitroInput testID="rtl-center" textAlign="center" defaultValue="Center" style={styles.field} />
      </Card>
    </ScrollView>
  )
}
