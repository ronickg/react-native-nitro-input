import React, {useRef, useState} from 'react';
import {Btn, Controls, Frame, Stage} from '../Demo/Demo';
import {MorphInputCanvas, type MorphInputCanvasHandle} from './MorphInputCanvas';

/** The amount field: prefix, grouping, decimals, placeholder, the buttons of the example app. */
export function MorphAmountDemo() {
  const ref = useRef<MorphInputCanvasHandle>(null);
  const [text, setText] = useState('');
  const [value, setValue] = useState(NaN);
  return (
    <Frame caption="Click the field and type. The amount is formatted by the C++ formatter before the input shows a frame; the morph is the C++ engine, both compiled to WebAssembly.">
      <Stage height={120}>
        <div style={{width: '100%'}}>
        <div style={{padding: '12px 16px 4px'}}>
          <MorphInputCanvas
            ref={ref}
            mode="number"
            prefix="$"
            prefixFontSize={30}
            affixAlign="top"
            placeholder="0"
            fontSize={56}
            fontWeight={800}
            textAlign="center"
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
        <Btn onClick={() => ref.current?.focus()}>Focus</Btn>
        <Btn onClick={() => ref.current?.setValue(1234.56)}>Set 1,234.56</Btn>
        <Btn onClick={() => ref.current?.setValue(98765)}>Set 98,765</Btn>
        <Btn onClick={() => ref.current?.clear()}>Clear</Btn>
      </Controls>
    </Frame>
  );
}

/** A plain text field: characters fade and scale, and a word that shrinks stays one shape. */
export function MorphTextDemo() {
  const ref = useRef<MorphInputCanvasHandle>(null);
  return (
    <Frame caption='Text mode: every character fades and scales in and out. Try "Continue" then "Confirm".'>
      <Stage height={80}>
        <div style={{width: '100%', padding: '12px 16px 4px'}}>
          <MorphInputCanvas ref={ref} placeholder="Type something" fontSize={34} fontWeight={600} />
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
export function MorphEuroDemo() {
  return (
    <Frame caption="Grouping with a dot, a comma for the decimal, and a currency code sitting on the digits' baseline.">
      <Stage height={100}>
        <div style={{width: '100%', padding: '12px 16px 4px'}}>
          <MorphInputCanvas
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
