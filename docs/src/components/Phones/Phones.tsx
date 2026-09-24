import React, {useEffect, useRef, useState} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './Phones.module.css';

/**
 * Screen recordings of the example app, captured on a Samsung Galaxy A22, a
 * budget phone, with its own screen recorder: what the library does on the
 * kind of hardware most people have, not on a flagship.
 *
 * The recordings are a few megabytes each, so a phone only fetches its video
 * once it is close to the viewport. Until then the frame holds its shape and
 * shows nothing.
 */
export default function Phones({
  videos,
  caption,
}: {
  videos: {src: string; label?: string}[];
  caption?: string;
}) {
  return (
    <figure className={styles.figure}>
      <div className={styles.row}>
        {videos.map((video) => (
          <Phone key={video.src} src={video.src} label={video.label} radius={36} />
        ))}
      </div>
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}

/** The bezel's width, `.screen`'s border in Phones.module.css. */
const BEZEL = 9;

function Phone({src: path, label, radius}: {src: string; label?: string; radius: number}) {
  const src = useBaseUrl(path);
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
      {label ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
