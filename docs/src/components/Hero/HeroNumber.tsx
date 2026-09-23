import React, {useEffect, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {NitroNumberCanvas, type NitroNumberCanvasHandle} from '../NitroNumber/NitroNumberCanvas';
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
  const ref = useRef<NitroNumberCanvasHandle>(null);
  const [value, setValue] = useState(12480.5);
  const [auto, setAuto] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(520);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setValue((v) => Math.max(0, Math.round((v + (Math.random() - 0.42) * 900) * 100) / 100));
    }, 1400);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(Math.min(520, el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The figure scales with the width it gets, so a phone shows the whole number.
  const fontSize = Math.max(40, Math.min(76, Math.floor(stageWidth / 6.8)));
  return (
    <div className={styles.stage} ref={stageRef}>
      <NitroNumberCanvas
        ref={ref}
        value={value}
        fractionDigits={2}
        groupingSeparator=","
        prefix="$"
        prefixFontSize={Math.round(fontSize * 0.45)}
        affixAlign="top"
        fontSize={fontSize}
        fontWeight={800}
        easing="spring"
        bounce={0.12}
        stagger={30}
        duration={700}
        textAlign="center"
        width={stageWidth}
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
