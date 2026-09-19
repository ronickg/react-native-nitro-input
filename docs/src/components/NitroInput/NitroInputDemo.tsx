import React, {useRef, useState} from 'react';
import {Btn, Controls, Frame, Stage} from '../Demo/Demo';
import {NitroInputCanvas, type NitroInputCanvasHandle} from './NitroInputCanvas';

const SPEEDS = [
  {label: 'Default', duration: 400},
  {label: 'Slow', duration: 900},
  {label: 'Fast', duration: 200},
] as const;
const EASINGS = ['expo', 'spring', 'linear'] as const;
const ALIGNS = [
  {label: 'L', value: 'left'},
  {label: 'C', value: 'center'},
  {label: 'R', value: 'right'},
] as const;
// The separators a locale swaps; the grouping rule itself is every three digits.
const LOCALES = [
  {label: 'en', grouping: ',', decimal: '.'},
  {label: 'de-DE', grouping: '.', decimal: ','},
  {label: 'fr-FR', grouping: '\u202F', decimal: ','},
] as const;
const DECIMALS = [0, 2] as const;

/** The amount field: prefix, grouping, decimals, placeholder, and the knobs to feel each one. */
export function NitroInputAmountDemo() {
  const ref = useRef<NitroInputCanvasHandle>(null);
  const [text, setText] = useState('');
  const [value, setValue] = useState(NaN);
  const [speed, setSpeed] = useState(0);
  const [easing, setEasing] = useState(0);
  const [align, setAlign] = useState(1);
  const [locale, setLocale] = useState(0);
  const [decimals, setDecimals] = useState(1);
  return (
    <Frame caption="Click the field and type, and turn the knobs while you do. The amount is formatted by the C++ formatter before the input shows a frame; the morph is the C++ engine, both compiled to WebAssembly.">
      <Stage height={120}>
        <div style={{width: '100%'}}>
        <div style={{padding: '12px 16px 4px'}}>
          <NitroInputCanvas
            ref={ref}
            mode="number"
            prefix="$"
            prefixFontSize={30}
            affixAlign="top"
            placeholder="0"
            fontSize={56}
            fontWeight={800}
            textAlign={ALIGNS[align].value}
            duration={SPEEDS[speed].duration}
            easing={EASINGS[easing]}
            fractionDigits={DECIMALS[decimals]}
            groupingSeparator={LOCALES[locale].grouping}
            decimalSeparator={LOCALES[locale].decimal}
            onChangeText={setText}
            onChangeValue={setValue}
          />
        </div>
        <p className="rn-demo-readout">
          onChangeText <code>"{text}"</code> · onChangeValue <code>{Number.isNaN(value) ? 'NaN' : String(value)}</code>
        </p>
        </div>
      </Stage>
      <Controls>
        {SPEEDS.map((s, i) => (
          <Btn key={s.label} selected={speed === i} onClick={() => setSpeed(i)}>{s.label}</Btn>
        ))}
        {EASINGS.map((e, i) => (
          <Btn key={e} selected={easing === i} onClick={() => setEasing(i)}>{e}</Btn>
        ))}
      </Controls>
      <Controls>
        {ALIGNS.map((a, i) => (
          <Btn key={a.label} selected={align === i} onClick={() => setAlign(i)}>{a.label}</Btn>
        ))}
        {LOCALES.map((l, i) => (
          <Btn key={l.label} selected={locale === i} onClick={() => setLocale(i)}>{l.label}</Btn>
        ))}
        {DECIMALS.map((d, i) => (
          <Btn key={d} selected={decimals === i} onClick={() => setDecimals(i)}>.{d}</Btn>
        ))}
      </Controls>
      <Controls>
        <Btn onClick={() => ref.current?.focus()}>Focus</Btn>
        <Btn onClick={() => ref.current?.setValue(1234.56)}>Set 1,234.56</Btn>
        <Btn onClick={() => ref.current?.setValue(98765)}>Set 98,765</Btn>
        <Btn onClick={() => ref.current?.setValue(9876543.21)}>Set 9,876,543.21</Btn>
        <Btn onClick={() => ref.current?.clear()}>Clear</Btn>
      </Controls>
    </Frame>
  );
}

/** A plain text field: characters fade and scale, and a word that shrinks stays one shape. */
export function NitroInputTextDemo() {
  const ref = useRef<NitroInputCanvasHandle>(null);
  return (
    <Frame caption='Text mode: every character fades and scales in and out. Try "Continue" then "Confirm".'>
      <Stage height={80}>
        <div style={{width: '100%', padding: '12px 16px 4px'}}>
          <NitroInputCanvas ref={ref} placeholder="Type something" fontSize={34} fontWeight={600} />
        </div>
      </Stage>
      <Controls>
        <Btn onClick={() => ref.current?.setText('Continue')}>Continue</Btn>
        <Btn onClick={() => ref.current?.setText('Confirm')}>Confirm</Btn>
        <Btn onClick={() => ref.current?.setText('Transaction safe')}>Transaction safe</Btn>
        <Btn onClick={() => ref.current?.clear()}>Clear</Btn>
      </Controls>
    </Frame>
  );
}

/** European separators and a currency code pinned to the bottom of the digits. */
export function NitroInputEuroDemo() {
  return (
    <Frame caption="Grouping with a dot, a comma for the decimal, and a currency code sitting on the digits' baseline.">
      <Stage height={100}>
        <div style={{width: '100%', padding: '12px 16px 4px'}}>
          <NitroInputCanvas
            mode="number"
            groupingSeparator="."
            decimalSeparator=","
            suffix=" EUR"
            suffixFontSize={20}
            suffixAlign="bottom"
            placeholder="0"
            fontSize={48}
            fontWeight={700}
            textAlign="center"
          />
        </div>
      </Stage>
    </Frame>
  );
}
