import React, {useEffect, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {RollingNumberCanvas, type RollingNumberCanvasHandle} from '../RollingNumber/RollingNumberCanvas';
import styles from './HeroNumber.module.css';

/**
 * The landing hero: a live figure that keeps ticking like a balance, driven
 * by the WebAssembly build of the same C++ engine the native views use.
 */
export default function HeroNumber() {
  return (
    <BrowserOnly fallback={<div className={styles.stage} style={{height: 96}} />}>
      {() => <LiveHero />}
    </BrowserOnly>
  );
}

function LiveHero() {
  const ref = useRef<RollingNumberCanvasHandle>(null);
  const [value, setValue] = useState(12480.5);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setValue((v) => Math.max(0, Math.round((v + (Math.random() - 0.42) * 900) * 100) / 100));
    }, 1400);
    return () => clearInterval(id);
  }, [auto]);
  return (
    <div className={styles.stage}>
      <RollingNumberCanvas
        ref={ref}
        value={value}
        fractionDigits={2}
        groupingSeparator=","
        prefix="$"
        prefixFontSize={34}
        affixAlign="top"
        fontSize={76}
        fontWeight={800}
        easing="spring"
        bounce={0.12}
        stagger={30}
        duration={700}
        textAlign="center"
        width={520}
        className={styles.number}
      />
      <div className={styles.buttons}>
        <button type="button" className="rn-btn" onClick={() => setValue((v) => v + 1000)}>
          +1,000
        </button>
        <button type="button" className="rn-btn" onClick={() => setValue((v) => Math.max(0, v - 1000))}>
          −1,000
        </button>
        <button type="button" className="rn-btn" onClick={() => setValue(Math.round(Math.random() * 100_000_000) / 100)}>
          Shuffle
        </button>
        <button type="button" className="rn-btn" onClick={() => setAuto((a) => !a)}>
          {auto ? 'Pause ticker' : 'Resume ticker'}
        </button>
      </div>
    </div>
  );
}
