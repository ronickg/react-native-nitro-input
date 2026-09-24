import React, {useEffect, useRef, useState} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './Phones.module.css';

/**
 * Side-by-side screen recordings of the example app, captured on an
 * iPhone 13 Pro Max and a Pixel 10. Same code, same engine, both platforms.
 *
 * The recordings are a few megabytes each and there are three pairs on the
 * landing page, so a phone only fetches its video once it is close to the
 * viewport. Until then the frame holds its shape and shows nothing.
 */
export default function Phones({
  ios,
  android,
  iosLabel = 'iOS',
  androidLabel = 'Android',
  caption,
}: {
  ios: string;
  android: string;
  iosLabel?: string;
  androidLabel?: string;
  caption?: string;
}) {
  const iosSrc = useBaseUrl(ios);
  const androidSrc = useBaseUrl(android);
  return (
    <figure className={styles.figure}>
      <div className={styles.row}>
        <Phone src={iosSrc} label={iosLabel} radius={44} />
        <Phone src={androidSrc} label={androidLabel} radius={36} />
      </div>
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}

/** The bezel's width, `.screen`'s border in Phones.module.css. */
const BEZEL = 9;

function Phone({src, label, radius}: {src: string; label: string; radius: number}) {
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      {rootMargin: '400px'},
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.phone}>
      <div ref={holder} className={styles.screen} style={{borderRadius: radius}}>
        {near ? (
          <video
            src={src}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            style={{borderRadius: radius - BEZEL}}
          />
        ) : null}
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
