import React, {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import {
  RollingNumberCanvas,
  type Easing,
  type RollingNumberCanvasHandle,
  type RollingNumberCanvasProps,
} from '../RollingNumber/RollingNumberCanvas';

/**
 * The docs' live examples: a stage with the real engine (WebAssembly) on the
 * left and the React Native code that produces the same thing on the right,
 * number-flow style (Preview / Code tabs).
 */

/** Width of a container element, kept current on resize (for canvases that need a pixel width). */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function Frame({children, caption}: {children: ReactNode; caption?: string}) {
  return (
    <div className="rn-demo">
      {children}
      {caption ? <p className="rn-demo-caption">{caption}</p> : null}
    </div>
  );
}

export function Stage({children, height}: {children: ReactNode; height?: number}) {
  return (
    <div className="rn-demo-stage" style={{minHeight: height}}>
      <BrowserOnly fallback={<div style={{height: height ?? 84}} />}>{() => <>{children}</>}</BrowserOnly>
    </div>
  );
}

export function Controls({children}: {children: ReactNode}) {
  return <div className="rn-demo-controls">{children}</div>;
}

export function Btn({
  children,
  onClick,
  primary,
  selected,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      className={['rn-btn', primary ? 'rn-btn--primary' : '', selected ? 'rn-btn--selected' : ''].join(' ')}
      onClick={onClick}>
      {children}
    </button>
  );
}

/** Preview / Code tabs around a demo. */
export function Example({code, children, caption}: {code: string; children: ReactNode; caption?: string}) {
  return (
    <Tabs groupId="demo-tabs">
      <TabItem value="preview" label="Preview" default>
        <Frame caption={caption}>{children}</Frame>
      </TabItem>
      <TabItem value="code" label="Code">
        <CodeBlock language="tsx">{code}</CodeBlock>
      </TabItem>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Ready-made demos used by the guides.
// ---------------------------------------------------------------------------

export function BasicDemo(props: Partial<RollingNumberCanvasProps>) {
  const [value, setValue] = useState(1234.5);
  return (
    <>
      <Stage>
        <RollingNumberCanvas value={value} fractionDigits={2} groupingSeparator="," prefix="$" fontSize={56} fontWeight={800} {...props} />
      </Stage>
      <Controls>
        <Btn onClick={() => setValue((v) => v + 1)}>+1</Btn>
        <Btn onClick={() => setValue((v) => v + 123.45)}>+123.45</Btn>
        <Btn onClick={() => setValue((v) => v * 10)}>×10</Btn>
        <Btn onClick={() => setValue((v) => v - 1)}>−1</Btn>
        <Btn onClick={() => setValue((v) => v / 10)}>÷10</Btn>
        <Btn onClick={() => setValue(Math.round(Math.random() * 100_000_000) / 100)}>Random</Btn>
        <Btn onClick={() => setValue((v) => -v)}>Negate</Btn>
        <Btn onClick={() => setValue(1234.5)}>Reset</Btn>
      </Controls>
    </>
  );
}

const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'] as const;

export function TimingDemo() {
  const [value, setValue] = useState(4280);
  const [easing, setEasing] = useState<(typeof EASINGS)[number]>('easeInOut');
  const [duration, setDuration] = useState(500);
  const [stagger, setStagger] = useState(0);
  const [bounce, setBounce] = useState(0.15);
  const bump = () => setValue((v) => v + 1000 + Math.round(Math.random() * 9000));
  return (
    <>
      <Stage>
        <RollingNumberCanvas value={value} groupingSeparator="," fontSize={56} fontWeight={800} easing={easing} duration={duration} stagger={stagger} bounce={bounce} />
      </Stage>
      <Controls>
        <Btn primary onClick={bump}>
          Roll
        </Btn>
        <Btn onClick={() => setValue((v) => Math.max(0, v - 1000 - Math.round(Math.random() * 9000)))}>Roll down</Btn>
        <label>
          easing
          <select value={easing} onChange={(e) => setEasing(e.target.value as (typeof EASINGS)[number])}>
            {EASINGS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          duration {duration} ms
          <input type="range" min={100} max={2000} step={50} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </label>
        <label>
          stagger {stagger} ms
          <input type="range" min={0} max={150} step={5} value={stagger} onChange={(e) => setStagger(Number(e.target.value))} />
        </label>
        {easing === 'spring' ? (
          <label>
            bounce {bounce.toFixed(2)}
            <input type="range" min={0} max={0.8} step={0.05} value={bounce} onChange={(e) => setBounce(Number(e.target.value))} />
          </label>
        ) : null}
      </Controls>
    </>
  );
}

type Transition = 'roll' | 'numeric' | 'scramble';
/** Each transition's own timing, as the React Native wrapper defaults it. */
const TRANSITION_DEFAULTS: Record<Transition, {duration: number; easing: Easing; stagger: number}> = {
  roll: {duration: 500, easing: 'easeInOut', stagger: 0},
  numeric: {duration: 450, easing: 'spring', stagger: 50},
  scramble: {duration: 500, easing: 'linear', stagger: 60},
};

export function TransitionsDemo() {
  const [value, setValue] = useState(4280);
  const [transition, setTransition] = useState<Transition>('numeric');
  const [duration, setDuration] = useState<number | null>(null);
  const [stagger, setStagger] = useState<number | null>(null);
  const defaults = TRANSITION_DEFAULTS[transition];
  const bump = () => setValue((v) => v + 1 + Math.round(Math.random() * 9));
  return (
    <>
      <Stage>
        <RollingNumberCanvas value={value} groupingSeparator="," fontSize={56} fontWeight={800} transition={transition} easing={defaults.easing} duration={duration ?? defaults.duration} stagger={stagger ?? defaults.stagger} />
      </Stage>
      <Controls>
        <Btn primary onClick={bump}>
          +1…10
        </Btn>
        <Btn onClick={() => setValue((v) => v + 1000 + Math.round(Math.random() * 9000))}>Big change</Btn>
        <Btn onClick={() => setValue((v) => Math.max(0, v - 1 - Math.round(Math.random() * 9)))}>Down</Btn>
        {(['numeric', 'scramble', 'roll'] as const).map((t) => (
          <Btn key={t} selected={transition === t} onClick={() => setTransition(t)}>
            {t}
          </Btn>
        ))}
        <label>
          duration {duration ?? defaults.duration} ms
          <input type="range" min={100} max={1500} step={50} value={duration ?? defaults.duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </label>
        <label>
          stagger {stagger ?? defaults.stagger} ms
          <input type="range" min={0} max={150} step={5} value={stagger ?? defaults.stagger} onChange={(e) => setStagger(Number(e.target.value))} />
        </label>
      </Controls>
    </>
  );
}

export function ChangeEffectsDemo() {
  const [value, setValue] = useState(64166.13);
  const [flash, setFlash] = useState(true);
  const [pop, setPop] = useState(0.08);
  const [transition, setTransition] = useState<Transition>('roll');
  const move = (sign: number) => setValue((v) => Math.max(0, Math.round((v + sign * (1 + Math.random() * 400)) * 100) / 100));
  return (
    <>
      <Stage>
        <RollingNumberCanvas
          value={value}
          fractionDigits={2}
          groupingSeparator=","
          prefix="$"
          fontSize={56}
          fontWeight={800}
          transition={transition}
          easing={TRANSITION_DEFAULTS[transition].easing}
          duration={TRANSITION_DEFAULTS[transition].duration}
          stagger={TRANSITION_DEFAULTS[transition].stagger}
          flashUpColor={flash ? '#16a34a' : undefined}
          flashDownColor={flash ? '#dc2626' : undefined}
          popOnChange={pop}
        />
      </Stage>
      <Controls>
        <Btn primary onClick={() => move(1)}>
          Up
        </Btn>
        <Btn primary onClick={() => move(-1)}>
          Down
        </Btn>
        <Btn selected={flash} onClick={() => setFlash((f) => !f)}>
          flash
        </Btn>
        <label>
          popOnChange {pop.toFixed(2)}
          <input type="range" min={0} max={0.4} step={0.02} value={pop} onChange={(e) => setPop(Number(e.target.value))} />
        </label>
        {(['roll', 'numeric', 'scramble'] as const).map((t) => (
          <Btn key={t} selected={transition === t} onClick={() => setTransition(t)}>
            {t}
          </Btn>
        ))}
      </Controls>
    </>
  );
}

export function CurrencyDemo() {
  const [value, setValue] = useState(4280.5);
  return (
    <>
      <Stage height={120}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start'}}>
          <RollingNumberCanvas value={value} fractionDigits={2} groupingSeparator="," prefix="$" prefixFontSize={24} affixAlign="top" fontSize={52} fontWeight={800} />
          <RollingNumberCanvas value={value} fractionDigits={2} groupingSeparator="," suffix=" USD" suffixFontSize={18} suffixAlign="bottom" fontSize={52} fontWeight={800} color="#5b5bd6" />
          <RollingNumberCanvas value={value} fractionDigits={2} groupingSeparator="," prefix="€" suffix=" EUR" prefixFontSize={24} suffixFontSize={16} prefixAlign="top" suffixAlign="bottom" fontSize={52} fontWeight={800} color="#0ea5e9" />
        </div>
      </Stage>
      <Controls>
        <Btn onClick={() => setValue((v) => v * 100)}>×100</Btn>
        <Btn onClick={() => setValue((v) => v / 100)}>÷100</Btn>
        <Btn onClick={() => setValue((v) => v + 0.99)}>+0.99</Btn>
        <Btn onClick={() => setValue(4280.5)}>Reset</Btn>
      </Controls>
    </>
  );
}

export function FitDemo() {
  const [value, setValue] = useState(875.4);
  return (
    <>
      <Stage height={96}>
        <div style={{width: 240, height: 76, border: '1px dashed var(--rn-card-border)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <RollingNumberCanvas value={value} fractionDigits={2} groupingSeparator="," prefix="$" fontSize={56} fontWeight={800} adjustsFontSizeToFit minimumFontScale={0.4} textAlign="center" width={220} />
        </div>
      </Stage>
      <Controls>
        <Btn onClick={() => setValue((v) => v * 10)}>×10</Btn>
        <Btn onClick={() => setValue((v) => v / 10)}>÷10</Btn>
        <Btn onClick={() => setValue((v) => v + 1)}>+1</Btn>
        <Btn onClick={() => setValue(875.4)}>Reset</Btn>
      </Controls>
    </>
  );
}

export function LoadingDemo() {
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState(0);
  const load = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setValue(Math.round(Math.random() * 900_000) / 100 + 1000);
      setLoading(false);
    }, 1600);
  }, []);
  useEffect(load, [load]);
  return (
    <>
      <Stage>
        <RollingNumberCanvas value={value} loading={loading} fractionDigits={2} groupingSeparator="," prefix="$" fontSize={56} fontWeight={800} textAlign="center" width={300} />
      </Stage>
      <Controls>
        <Btn primary onClick={load}>
          Reload
        </Btn>
        <Btn onClick={() => setLoading((l) => !l)}>{loading ? 'Stop loading' : 'Loading…'}</Btn>
      </Controls>
    </>
  );
}

export function ImperativeDemo() {
  const ref = useRef<RollingNumberCanvasHandle>(null);
  const [scrub, setScrub] = useState(1234.5);
  return (
    <>
      <Stage>
        <RollingNumberCanvas ref={ref} value={42} fractionDigits={1} minimumIntegerDigits={4} fontSize={56} fontWeight={800} fontFamily="ui-monospace, Menlo, monospace" color="#22c55e" easing="easeOut" duration={400} />
      </Stage>
      <Controls>
        <Btn onClick={() => ref.current?.animateTo(7)}>animateTo(7)</Btn>
        <Btn onClick={() => ref.current?.animateTo(9999)}>animateTo(9999)</Btn>
        <Btn onClick={() => ref.current?.jumpTo(999.75)}>jumpTo(999.75)</Btn>
        <label style={{flexBasis: '100%'}}>
          jumpTo({scrub.toFixed(2)}) — drag to scrub
          <input
            type="range"
            min={0}
            max={2000}
            step={0.25}
            value={scrub}
            style={{width: '100%'}}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScrub(v);
              ref.current?.jumpTo(v);
            }}
          />
        </label>
      </Controls>
    </>
  );
}

export function RevealDemo({initialStyle = 'count', milestones = false}: {initialStyle?: 'count' | 'spin'; milestones?: boolean}) {
  const ref = useRef<RollingNumberCanvasHandle>(null);
  const [amount, setAmount] = useState(50000);
  const [reveal, setReveal] = useState(false);
  const [style, setStyle] = useState<'count' | 'spin'>(initialStyle);
  const [tiers, setTiers] = useState(milestones);
  const [status, setStatus] = useState('Ready when you are');
  const [hits, setHits] = useState<number[]>([]);
  const rearm = () => {
    setStatus('Ready when you are');
    setHits([]);
  };
  const [cardRef, cardWidth] = useContainerWidth<HTMLDivElement>();
  const figureWidth = Math.max(200, cardWidth - 40);
  const fontSize = figureWidth < 340 ? Math.max(30, Math.floor(figureWidth / 6.5)) : 52;
  return (
    <>
      <Stage height={150}>
        <div
          ref={cardRef}
          style={{
            background: 'var(--rn-brand)',
            borderRadius: 16,
            padding: '24px 20px',
            width: '100%',
            maxWidth: 420,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            color: '#fff',
          }}>
          <div style={{fontWeight: 700, fontSize: 16}}>Congrats!</div>
          <RollingNumberCanvas
            ref={ref}
            value={amount}
            reveal={reveal}
            revealStyle={style}
            revealMilestones={tiers ? [1000, 10000, 25000] : undefined}
            revealMilestoneHold={400}
            revealDuration={tiers && style === 'count' ? 4800 : 2200}
            onRevealMilestone={(index, value) => setHits((h) => [...h, value])}
            onRevealEnd={() => setStatus('Credit unlocked')}
            prefix="$"
            fractionDigits={2}
            groupingSeparator=","
            fontSize={fontSize}
            fontWeight={800}
            color="#fff"
            textAlign="center"
            width={figureWidth}
            skipOnClick
          />
          <div style={{fontSize: 13, opacity: 0.85}}>
            {reveal && status !== 'Credit unlocked' ? (style === 'spin' ? 'Spinning… (click the number to skip)' : 'Counting… (click the number to skip)') : status}
            {hits.length ? ` · tiers hit: ${hits.map((h) => '$' + h.toLocaleString()).join(', ')}` : ''}
          </div>
        </div>
      </Stage>
      <Controls>
        <Btn
          primary
          onClick={() => {
            rearm();
            setReveal((r) => !r);
          }}>
          {reveal ? 'Reset' : 'Reveal'}
        </Btn>
        <Btn selected={style === 'count'} onClick={() => { setReveal(false); rearm(); setStyle('count'); }}>
          count
        </Btn>
        <Btn selected={style === 'spin'} onClick={() => { setReveal(false); rearm(); setStyle('spin'); }}>
          spin
        </Btn>
        <Btn selected={tiers} onClick={() => { setReveal(false); rearm(); setTiers((t) => !t); }}>
          tiers 1k / 10k / 25k
        </Btn>
        <Btn
          onClick={() => {
            setReveal(false);
            rearm();
            setAmount(Math.round(Math.random() * 9_999_999) / 100);
          }}>
          Random amount
        </Btn>
        <Btn
          onClick={() => {
            rearm();
            ref.current?.revealTo(1234.56);
          }}>
          revealTo(1,234.56)
        </Btn>
      </Controls>
    </>
  );
}
