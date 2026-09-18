import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './Phones.module.css';

/**
 * Side-by-side screen recordings of the example app, captured on an iPhone
 * simulator and a Pixel 10. Same code, same engine, both platforms.
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

function Phone({src, label, radius}: {src: string; label: string; radius: number}) {
  return (
    <div className={styles.phone}>
      <div className={styles.screen} style={{borderRadius: radius}}>
        <video src={src} autoPlay loop muted playsInline preload="metadata" />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
